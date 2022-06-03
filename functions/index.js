const functions = require('firebase-functions')
const { sendEmail } = require('./emails')
const { PubSub } = require('@google-cloud/pubsub')
const admin = require('firebase-admin')
const { addDiscordRole } = require('./discord_integration')
const { userCompletedCourse } = require('../lib/checkUserLessons')

admin.initializeApp()

const db = admin.firestore()

const pubsub = new PubSub()

exports.sendEmail = functions.https.onRequest(async (req, resp) => {
  const subject =
    req.query.subject || '🏕️ Seu primeiro Smart Contract na Ethereum'
  resp.send(await sendEmail(req.query.template, subject, req.query.to))
})

exports.sendNFTEmails = functions.https.onRequest(async (req, resp) => {
  const subject = '👷👷‍♀️ WEB3DEV - NFT Recebido: Smart Contract Solidity'

  people = require('../nfts/scripts/people.json')

  for (let i = 0; i < people.length; i++) {
    p = people[i]
    sendEmail('nft_delivery.js', subject, p.email, {
      course_title: 'Smart Contract Solidity',
      wallet_address: p.wallet,
      nft_contract: '0xa68580d4e41925c20af20dba9b4db17a79842f19',
      nft_id: i + 2,
    })
  }

  resp.send({ ok: 200 })
})

async function docData(collection, doc_id) {
  return (await db.collection(collection).doc(doc_id).get()).data();
}

async function emailParams(cohort) {
  return {
    cohort: await docData("cohorts", cohort.cohort_id),
    course: await docData("courses", cohort.course_id),
  };
}

exports.onCohortSignup = functions.firestore
  .document("users/{userId}")
  .onUpdate(async (change, context) => {
    const previousUserValue = change.before.data();
    const user = change.after.data();
    const previousCohortData = previousUserValue.cohorts.map((item) => item?.cohort_id);
    const userNewCohorts = user.cohorts.filter(
      (item) => !previousCohortData?.includes(item.cohort_id)
    );

    for (let cohortSnapshot of userNewCohorts) {
      const params = emailParams(cohortSnapshot);
      //todo essas funções deveriam ser enfileiradas num pubsub para evitar falhas
      await Promise.all([
        sendEmail("on_cohort_signup.js", params.cohort.email_content.subject, user.email, params),
        addDiscordRole(user?.discord?.id, params.cohort.discord_role),
      ]);
    }
  });

exports.onDiscordConnect = functions.firestore
  .document("users/{userId}")
  .onUpdate(async (change, context) => {
    const previousUserValue = change.before.data();
    const newUserValue = change.after.data();

    function userConnectedDiscord() {
      return newUserValue.discord?.id && newUserValue.discord?.id !== previousUserValue.discord?.id;
    }

    if (!userConnectedDiscord()) return;

    const cohorts = db.collection("cohorts");

    for (let cohortSnapshot of newUserValue.cohorts) {
      const params = {
        cohort: (await cohorts.doc(cohortSnapshot.cohort_id).get()).data(),
      };
      //todo essas funções deveriam ser enfileiradas num pubsub para evitar falhas
      await Promise.all([addDiscordRole(newUserValue?.discord?.id, params.cohort.discord_role)]);
    }
  })
exports.mintNFT = functions.firestore
  .document('lessons_submissions/{lessonId}')
  .onCreate(async (snap, context) => {
    const createdLesson = snap.data()
    if(createdLesson.lesson !== 'Lesson_2_Finalize_Celebrate.md') return // verificar depois pra pegar a ultima lição dinamicamente ou padronizar este nome para sempre ser a ultima lição

    const user = await db.collection('users').doc(createdLesson.user_id).get()
    const cohort = (await db.collection('cohorts').doc(createdLesson.cohort_id).get()).data()
    const course = (await db.collection('courses').doc(cohort.data().course_id).get()).data()
    
    if(!userCompletedCourse(user.id, cohort.course_id))
      return console.log('Usuário não completou todas as lições')
      
    mint((createdLesson.cohort_id, course.nft_title, user.wallet))

  })

exports.sendEmailJob = functions.pubsub.topic("course_day_email").onPublish((message) => {
  const data = JSON.parse(Buffer.from(message.data, "base64"));

  console.log(`Sending message ${data.subject} template ${data.template} to ${data.to}`);

  return sendEmail(data.template, data.subject, data.to, data.params);
});

exports.sendEmailToAllUsersInCohort = functions.https.onRequest(async (req, resp) => {
  db.collection("users")
    .get()
    .then((querySnapshot) => {
      console.log(querySnapshot.size);
      const emails = querySnapshot.docs.map(async (doc) => {
        const user = doc.data();
        const userCohort = user.cohorts.find((cohort) => cohort.cohort_id === req.query.cohort_id);
        if (!userCohort || !user.email) return 0;
        const cohort = await docData("cohorts", userCohort.cohort_id);
        if (cohort) {
          const messageObject = {
            to: user.email,
            template: req.query.template,
            subject: cohort.email_content.subject,
            params: await emailParams(userCohort),
          };
          const messageBuffer = Buffer.from(JSON.stringify(messageObject), "utf8");

          pubsub.topic("course_day_email").publishMessage({ data: messageBuffer });
        }
        return 1;
      });
      Promise.all(emails).then((results) => {
        console.log("Sent emails: " + results.reduce((acc, curr) => acc + curr, 0));
      });
    });
  resp.send("OK");
});

exports.addUserToDiscord = functions.https.onRequest(async (req, resp) => {
  addUserToRole(req.query.user_id, req.query.role_id).then((r) =>
    resp.send('OK')
  )
})

exports.addAllUsersFromCohortToDiscord = functions.https.onRequest(
  async (req, resp) => {
    const cohort_id = req.query.cohort_id
    const cohort = (await db.collection('cohorts').doc(cohort_id).get()).data()

    if (!cohort) {
      console.log('invalid cohort')
      return resp.send('invalid cohort')
    }

    const users = await db.collection('users').get()

    if (users.empty) {
      console.log('no users to change')
      return resp.send('no users')
    }

    users.forEach(async (doc) => {
      const data = doc.data()
      if (
        data.cohorts &&
        data.cohorts[0] &&
        data?.discord?.id &&
        data.cohorts[0].cohort_id === cohort_id
      ) {
        console.log(
          `Adicionando role ${cohort.discord_role} do curso no discord: ${data.discord.username}`
        )
        try {
          await addDiscordRole(data.discord.id, cohort.discord_role)
        } catch (exception) {
          console.log(exception)
        }
      }
    })
    resp.send('OK')
  }
)
