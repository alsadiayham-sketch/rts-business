// Firebase config for Aqqad POS
var firebaseConfig = {
    apiKey: "AIzaSyAp3mDn6c5D3GKIV7BZ2aKIsm7MxYP0vG0",
    authDomain: "dimaboutique-b4f16.firebaseapp.com",
    projectId: "dimaboutique-b4f16",
    storageBucket: "dimaboutique-b4f16.appspot.com",
    messagingSenderId: "552629390598",
    appId: "1:552629390598:web:7b2a3f2f5e8c4a5b6d7e8f"
};

var firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

var rawDb = firebase.firestore();
var PROJECT_ID = 'aqqad';

var db = {
    collection: function (name) {
        return rawDb.collection('projects').doc(PROJECT_ID).collection(name);
    }
};

module.exports = { db: db, rawDb: rawDb, firebase: firebase, PROJECT_ID: PROJECT_ID };
