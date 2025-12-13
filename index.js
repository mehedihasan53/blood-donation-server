const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors')
require('dotenv').config()

const app = express()
const port = 3000

app.use(cors())
app.use(express.json())


// middleware

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }

    try {
        const token = authHeader.split(' ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        console.log("decoded info", decodedToken);
        req.decoded_email = decodedToken.email;
        next();
    } catch (error) {
        console.error(error);
        res.status(401).send({ message: 'Unauthorized access' });
    }
};




const uri = process.env.MONGODB_URI;
console.log(uri);

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        //collections
        const database = client.db('bloodDonationDB')
        const usersCollections = database.collection('users');
        const donationRequestsCollection = database.collection('donationRequests');

        // Create user
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            userInfo.role = "donor"
            userInfo.status = "active"
            userInfo.createdAt = new Date();

            const result = await usersCollections.insertOne(userInfo)
            res.send(result)
        })

        // Get user by email
        app.get('/users/role/:email', async (req, res) => {
            const { email } = req.params;
            console.log(email);

            const query = { email: email }
            const result = await usersCollections.findOne(query)
            console.log(result);

            res.send(result)

        })

        // Create donation request
        app.post('/donation-requests', verifyFBToken, async (req, res) => {
            const requestInfo = req.body;
            requestInfo.status = 'pending';
            requestInfo.createdAt = new Date();

            const result = await donationRequestsCollection.insertOne(requestInfo)
            res.send(result)
        })


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);






app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`)
})