const nodemailer = require('nodemailer');
const fs = require('fs');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_APP_PASSWORD
  }
});

function log(line) {
  fs.appendFileSync('email_log.txt', new Date().toISOString() + ' ' + line + '\n');
}

async function sendStatusEmail(to, itemName, status, returnDate) {
  let text = `Your borrow request for '${itemName}' is now: ${status}.`;
  if (returnDate) text += ` Please return it on or before: ${returnDate}.`;
  const subject = `PCO Borrowing System: request ${status}`;

  log(`REQUEST to=${to} subject=${subject} body=${text}`);
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_USERNAME, to, subject, text
    });
    log(`RESPONSE ${info.response} accepted=${info.accepted} rejected=${info.rejected}`);
    return true;
  } catch (e) {
    log(`RESPONSE failed: ${e.message}`);
    return false;
  }
}

module.exports = { sendStatusEmail };