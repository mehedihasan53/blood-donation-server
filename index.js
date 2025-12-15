const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto");

app.use(cors());
app.use(express.json());

// middleware

const admin = require("firebase-admin");
const { log } = require("console");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
    "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized access" });
    }

    try {
        const token = authHeader.split(" ")[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        console.log("decoded info", decodedToken);
        req.decoded_email = decodedToken.email;
        next();
    } catch (error) {
        console.error(error);
        res.status(401).send({ message: "Unauthorized access" });
    }
};

const uri = process.env.MONGODB_URI;
console.log(uri);

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();

        //collections
        const database = client.db("bloodDonationDB");
        const usersCollections = database.collection("users");
        const donationRequestsCollection = database.collection("donationRequests");
        const paymentsCollection = database.collection("payments");

        // Create user
        app.post("/users", async (req, res) => {
            const userInfo = req.body;
            userInfo.role = "donor";
            userInfo.status = "active";
            userInfo.createdAt = new Date();

            const result = await usersCollections.insertOne(userInfo);
            res.send(result);
        });

        // Get all users
        app.get("/users", verifyFBToken, async (req, res) => {
            const result = await usersCollections.find({}).toArray();
            res.status(200).send(result);
        });

        // Get user by email
        app.get("/users/role/:email", async (req, res) => {
            const { email } = req.params;
            console.log(email);

            const query = { email: email };
            const result = await usersCollections.findOne(query);
            console.log(result);

            res.send(result);
        });

        app.patch("/update/user/status", verifyFBToken, async (req, res) => {
            const { email, status } = req.query;
            const query = { email: email };
            const updatedStatus = {
                $set: {
                    status: status,
                },
            };
            const result = await usersCollections.updateOne(query, updatedStatus);
            res.send(result);
        });

        // Update user role
        app.patch("/update/user/role", verifyFBToken, async (req, res) => {
            const { email, role } = req.query;
            const query = { email: email };
            const updatedRole = {
                $set: {
                    role: role,
                },
            };
            const result = await usersCollections.updateOne(query, updatedRole);
            res.send(result);
        });

        // Create donation request
        app.post("/donation-requests", verifyFBToken, async (req, res) => {
            const requestInfo = req.body;
            requestInfo.requesterEmail = req.decoded_email;
            requestInfo.status = "pending";
            requestInfo.createdAt = new Date();

            const result = await donationRequestsCollection.insertOne(requestInfo);
            res.send(result);
        });

        // Get my donation requests
        app.get("/donation-requests", verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const size = Number(req.query.size) || 5;
            const page = Number(req.query.page) || 0;
            const status = req.query.status;

            const query = { requesterEmail: email };
            if (status && status !== "all") query.status = status;

            const result = await donationRequestsCollection
                .find(query)
                .limit(size)
                .skip(size * page)
                .toArray();

            const totalRequest = await donationRequestsCollection.countDocuments(
                query
            );
            res.send({ request: result, totalRequest });
        });

        // Get single request by ID
        app.get("/donation-requests/:id", verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const request = await donationRequestsCollection.findOne({
                _id: new ObjectId(id),
            });
            res.send(request);
        });

        // Update request by ID
        app.patch("/donation-requests/:id", verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const updateData = req.body;
            const result = await donationRequestsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateData }
            );
            res.send(result);
        });

        // Delete request by ID
        app.delete("/donation-requests/:id", verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const result = await donationRequestsCollection.deleteOne({
                _id: new ObjectId(id),
            });
            res.send(result);
        });

        // payment gateway
        app.post("/create-payment-checkout", async (req, res) => {
            const information = req.body;
            // console.log(information);
            const amount = parseInt(information.donateAmount) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: "usd",
                            unit_amount: amount,
                            product_data: {
                                name: "Please donate for the cause",
                            },
                        },
                        quantity: 1,
                    },
                ],
                mode: "payment",
                metadata: {
                    donorName: information?.donarName,
                },
                customer_email: information?.donorEmail,
                success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel`,
            });

            res.send({ url: session.url });
        });

        // payment success
        app.post("/success-payment", async (req, res) => {
            const { session_id } = req.query;
            const session = await stripe.checkout.sessions.retrieve(session_id);
            console.log(session);
            const transactionId = session.payment_intent;

            if (session.payment_status == "paid") {
                const paymentInfo = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    donorEmail: session.customer_email,
                    transactionId: transactionId,
                    payment_status: session.payment_status,
                    paidAt: new Date(),
                };
                const result = await paymentsCollection.insertOne(paymentInfo);
                return res.send(result);
            }
        });

        // search request
        app.get("/search-request", async (req, res) => {
            const { bloodGroup, district, upazila } = req.query;

            if (!bloodGroup) {
                return res.status(400).send({ message: "bloodGroup is required" });
            }

            const query = { bloodGroup };

            if (district && district !== "") {
                query.recipientDistrict = district;
            }

            if (upazila && upazila !== "") {
                query.recipientUpazila = upazila;
            }

            const result = await donationRequestsCollection.find(query).toArray();
            res.send(result);
        });

        // Admin Dashboard Stats
        app.get("/dashboard/stats", verifyFBToken, async (req, res) => {
            const totalUsers = await usersCollections.countDocuments();

            const totalDonors = await usersCollections.countDocuments({
                role: "donor",
            });

            const totalRequests = await donationRequestsCollection.countDocuments();

            const pendingRequests = await donationRequestsCollection.countDocuments({
                status: "pending",
            });

            const completedRequests = await donationRequestsCollection.countDocuments(
                {
                    status: "done",
                }
            );

            const fundingAgg = await paymentsCollection
                .aggregate([
                    {
                        $group: {
                            _id: null,
                            totalAmount: { $sum: "$amount" },
                        },
                    },
                ])
                .toArray();

            const totalFunding =
                fundingAgg.length > 0 ? fundingAgg[0].totalAmount : 0;

            const recentDonations = await donationRequestsCollection
                .find({})
                .sort({ createdAt: -1 })
                .limit(5)
                .toArray();

            res.send({
                success: true,
                stats: {
                    totalUsers,
                    totalDonors,
                    totalRequests,
                    pendingRequests,
                    completedRequests,
                    totalFunding,
                    recentDonations,
                },
            });
        });

        await client.db("admin").command({ ping: 1 });
        console.log(
            "Pinged your deployment. You successfully connected to MongoDB!"
        );
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});
