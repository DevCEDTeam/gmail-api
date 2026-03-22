require('dotenv').config();
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  SENDER_EMAIL,
  SENDER_NAME,
  RECIPIENT_EMAIL,
} = process.env;

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

async function sendMail() {
  const accessToken = await oAuth2Client.getAccessToken();

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: SENDER_EMAIL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: REFRESH_TOKEN,
      accessToken: accessToken.token,
    },
  });

  const mailOptions = {
    from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
    to: RECIPIENT_EMAIL,
    subject: 'Hello from gmail using API',
    text: 'Hello from gmail email using API',
    html: '<h1>Hello from gmail email using API</h1>',
  };

  const result = await transport.sendMail(mailOptions);
  return result;
}

sendMail()
  .then((result) => console.log('Email sent...', result))
  .catch((error) => console.log('Error:', error.message));
