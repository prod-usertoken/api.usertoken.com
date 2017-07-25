/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';
console.log = function(){}

// const jwt = require('jsonwebtoken');
// const nJwt = require('njwt');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Language = require('@google-cloud/language');
const express = require('express');
const fetch = require('node-fetch');
const serialize = require('serialize-javascript');

const app = express();
const language = new Language({projectId: process.env.GCLOUD_PROJECT});

admin.initializeApp(functions.config().firebase);

// var kid;
// var token;

// var bearerToken;
// const serviceAccount = require("./api-functions-acc3a1a7695f.json");
// const privateKey = serviceAccount.private_key;
// const privateKeyId = serviceAccount.private_key_id;
// const credential = admin.credential.cert(serviceAccount);
// console.log('0.functions index.js serviceAccount : ', serviceAccount);
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   databaseURL: 'https://' +process.env.GCLOUD_PROJECT+ '.firebaseio.com'
// });

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const authenticate = (req, res, next) => {
  console.log('1.functions index.js authenticate headers : ', req.headers);
  if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
    res.status(403).send('Unauthorized');
    return;
  }

  const idToken = req.headers.authorization.split('Bearer ')[1];
  // bearerToken = idToken;
  admin.auth().verifyIdToken(idToken).then(decodedIdToken => {
    req.user = decodedIdToken;
    next();
  }).catch(error => {
    res.status(403).send('Unauthorized');
  });
};

app.use(authenticate);

// POST /api/uploadjwt
// uploadjwt AWT token into JSON
app.post('/api/uploadjwt', (req, res) => {
  const token = req.query.token;
  console.log('1.functions index.js app.post /api/uploadjwt token : ', token);
  if (token) {
    admin.auth().verifyIdToken(token).then(decodedIdToken => {
      console.log('2.functions index.js app.post /api/uploadjwt decodedIdToken : ', decodedIdToken);
      const uid = decodedIdToken.user_id;
      const ref = admin.database().ref(`/usertoken/${uid}`);
      ref.update({
        "configs/jwt": token
      }, (err) => {
        if (err) {
          console.log('3..functions index.js app.post /api/uploadjwt error: ', err);
          res.status(500).send('jwt token save error : ' + err);
        };
        res.status(201).send('jwt token save successful');
      });
    });
  }
  return
});

// POST /api/messages
// Create a new message, get its sentiment using Google Cloud NLP,
// and categorize the sentiment before saving.
app.post('/api/messages', (req, res) => {

  const message = req.body.message;
  console.log('1.functions index.js app.post /api/messages : ', message);
  language.detectSentiment(message).then(results => {
    const category = categorizeScore(results[0].score);
    const data = {message: message, sentiment: results, category: category};
    return admin.database().ref(`/usertoken/${req.user.uid}/messages`).push(data);
  }).then(snapshot => {
    return snapshot.ref.once('value');
  }).then(snapshot => {
    const val = snapshot.val();
    res.status(201).json({message: val.message, category: val.category});
  }).catch(error => {
    // console.log('Error detecting sentiment or saving message', error.message);
    res.sendStatus(500);
  });
});

// GET /api/messages?category={category}
// Get all messages, optionally specifying a category to filter on
app.get('/api/messages', (req, res) => {
  const category = req.query.category;
  console.log('1.functions index.js app.get /api/messages category : ', category);
  let query = admin.database().ref(`/usertoken/${req.user.uid}/messages`);

  if (category && ['positive', 'negative', 'neutral'].indexOf(category) > -1) {
    // Update the query with the valid category
    query = query.orderByChild('category').equalTo(category);
  } else if (category) {
    return res.status(404).json({errorCode: 404, errorMessage: `category '${category}' not found`});
  }

  query.once('value').then(snapshot => {
    var messages = [];

    snapshot.forEach(childSnapshot => {
      messages.push({key: childSnapshot.key, message: childSnapshot.val().message});
    });

    return res.status(200).json(messages);
  }).catch(error => {
    console.log('Error getting messages', error.message);
    res.sendStatus(500);
  });
});

// GET /api/message/{messageId}
// Get details about a message
app.get('/api/message/:messageId', (req, res) => {
  const messageId = req.params.messageId;
  console.log('1.functions index.js app.get /api/message/:messageId : ', messageId);
  admin.database().ref(`/usertoken/${req.user.uid}/messages/${messageId}`).once('value').then(snapshot => {
    if (snapshot.val() !== null) {
      // Cache details in the browser for 5 minutes
      res.set('Cache-Control', 'private, max-age=300');
      res.status(200).json(snapshot.val());
    } else {
      res.status(404).json({errorCode: 404, errorMessage: `message '${messageId}' not found`});
    }
  }).catch(error => {
    console.log('Error getting message details', messageId, error.message);
    res.sendStatus(500);
  });
});

// GET /api/configs
// Get default config
app.get('/api/configs', (req, res) => {
  console.log('1.functions index.js app.get /api/configs (default)');
  // loads default config
  admin.database().ref(`/usertoken/default/configs/default`).once('value').then(snapshot => {
    if (snapshot.val() !== null) {
  console.log('2.functions index.js app.get /api/configs (default) : ',snapshot.val());
      // Cache details in the browser for 5 minutes
      res.set('Cache-Control', 'private, max-age=300');
      res.status(200).json(snapshot.val());
    }
  });
});

// GET /api/config/{configId}
// Get details about a config
app.get('/api/config/:configId', (req, res) => {
  const configId = req.params.configId;
  console.log('1.functions index.js app.get /api/config/:configId : ', configId);
  admin.database().ref(`/usertoken/${req.user.uid}/configs/${configId}`).once('value').then(snapshot => {
    if (snapshot.val() !== null) {
      // Cache details in the browser for 5 minutes
      res.set('Cache-Control', 'private, max-age=300');
      res.status(200).json(snapshot.val());
    } else {
      res.status(404).json({errorCode: 404, errorMessage: `config '${configId}' not found`});
    }
  }).catch(error => {
    console.log('Error getting config details', configId, error.message);
    res.sendStatus(500);
  });
});

// Expose the API as a function
exports.api = functions.https.onRequest(app);

// Helper function to categorize a sentiment score as positive, negative, or neutral
const categorizeScore = score => {
  console.log('1.functions index.js categorizeScore : ', categorizeScore);
  if (score > 0.25) {
    return 'positive';
  } else if (score < -0.25) {
    return 'negative';
  }
  return 'neutral';
};
