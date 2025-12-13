const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors')
require('dotenv').config()

const app = express()
const port = 3000

app.use(cors())
app.use(express.json())


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
        

        // user post role
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            userInfo.role = "donor"
            userInfo.status = "active"
            userInfo.createdAt = new Date();

            const result = await usersCollections.insertOne(userInfo)
            res.send(result)
        })

        app.get('/users/role/:email', async (req, res) => {
            const { email } = req.params;
            console.log(email);

            const query = { email: email }
            const result = await usersCollections.findOne(query)
            console.log(result);

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