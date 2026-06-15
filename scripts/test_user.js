const admin = require("firebase-admin");
admin.initializeApp({
  projectId: "mypresence-db",
  databaseURL: "https://mypresence-db-default-rtdb.asia-southeast1.firebasedatabase.app"
});

async function run() {
  const users = await admin.database().ref('users').once('value');
  console.log(users.val());
  process.exit(0);
}
run();
