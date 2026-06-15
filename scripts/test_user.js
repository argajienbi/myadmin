const admin = require("firebase-admin");
admin.initializeApp({
  projectId: "gen-lang-client-0022373400",
  databaseURL: "https://gen-lang-client-0022373400-default-rtdb.asia-southeast1.firebasedatabase.app"
});

async function run() {
  const users = await admin.database().ref('users').once('value');
  console.log(users.val());
  process.exit(0);
}
run();
