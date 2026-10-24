
require("dotenv").config();

const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");
const { parse } = require("csv-parse/sync");

// All files are stored beside index.js.
const BASE_DIR = __dirname;
const CONTACTS_FILE = path.join(BASE_DIR, "contacts.csv");
const RESUME_FILE = path.join(BASE_DIR, "resume.pdf");
const LOG_FILE = path.join(BASE_DIR, "sent-log.json");

const DELAY_MS = 10_000;
const MAX_DAILY_LIMIT = 250;

const configuredLimit = Number(process.env.DAILY_LIMIT || 100);
const DAILY_LIMIT = Math.min(
  MAX_DAILY_LIMIT,
  Math.max(1, Number.isFinite(configuredLimit) ? configuredLimit : 100)
);

const SEND_EMAILS =
  String(process.env.SEND_EMAILS || "false").toLowerCase() === "true";

const MY_DETAILS = {
  name: process.env.MY_NAME || "",
  phone: process.env.MY_PHONE || "",
  email: process.env.MY_EMAIL || "",
  github: process.env.MY_GITHUB || "",
  linkedin: process.env.MY_LINKEDIN || "",
  profileSummary: process.env.MY_PROFILE_SUMMARY || "",
  coreSkills: process.env.MY_CORE_SKILLS || "",
};

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function emailKey(email) {
  return String(email || "").trim().toLowerCase();
}

function saveLog(log) {
  const tempFile = `${LOG_FILE}.tmp`;

  // Write the complete updated history before replacing the old file.
  fs.writeFileSync(tempFile, JSON.stringify(log, null, 2), "utf8");
  fs.renameSync(tempFile, LOG_FILE);
}

function loadLog() {
  if (!fs.existsSync(LOG_FILE)) {
    saveLog({});
    return {};
  }

  const contents = fs.readFileSync(LOG_FILE, "utf8").trim();

  if (!contents) {
    throw new Error(
      'sent-log.json is empty. Back it up, then put {} in the file only if there is no history to recover.'
    );
  }

  let log;

  try {
    log = JSON.parse(contents);
  } catch {
    throw new Error(
      "sent-log.json contains invalid JSON. Back it up and repair it before sending emails."
    );
  }

  if (!log || typeof log !== "object" || Array.isArray(log)) {
    throw new Error(
      "sent-log.json must contain a JSON object. Restore a valid history file before continuing."
    );
  }

  return log;
}

function sentToday(log) {
  return Object.values(log).filter((entry) => {
    if (!entry || entry.status !== "sent" || !entry.timestamp) {
      return false;
    }

    const timestamp = new Date(entry.timestamp);

    return (
      !Number.isNaN(timestamp.getTime()) &&
      timestamp.getFullYear() === new Date().getFullYear() &&
      timestamp.getMonth() === new Date().getMonth() &&
      timestamp.getDate() === new Date().getDate()
    );
  }).length;
}

function loadContacts() {
  if (!fs.existsSync(CONTACTS_FILE)) {
    throw new Error(`Contacts file not found: ${CONTACTS_FILE}`);
  }

  const csvText = fs.readFileSync(CONTACTS_FILE, "utf8");

  const contacts = parse(csvText, {
    columns: (headers) =>
      headers.map((header) =>
        header.replace(/^\uFEFF/, "").trim().toLowerCase()
      ),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (contacts.length === 0) {
    throw new Error("contacts.csv has no contact rows.");
  }

  const requiredColumns = ["name", "email", "company"];
  const availableColumns = Object.keys(contacts[0] || {});

  for (const column of requiredColumns) {
    if (!availableColumns.includes(column)) {
      throw new Error(
        `Missing required CSV column "${column}". Expected headers: name,email,company,role`
      );
    }
  }

  return contacts;
}

function createEmail(contact) {
  const missingProfileSettings = Object.entries(MY_DETAILS)
    .filter(([, value]) => !value)
    .map(([key]) => `MY_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`);
  if (missingProfileSettings.length > 0) {
    throw new Error(
      `Email profile configuration is incomplete. Check ${missingProfileSettings.join(", ")} in .env.`
    );
  }

  const recipientName = String(contact.name || "").trim();
  const firstName = recipientName.split(/\s+/)[0] || "Hiring Manager";
  const company = String(contact.company || "").trim();
  const role = String(contact.role || "").trim();

  const subject =
    `Application / Opportunities – Full Stack Developer (MERN) | ${MY_DETAILS.name}`;

  const roleLine = role
    ? `I’m reaching out to enquire about suitable entry-level or junior opportunities related to ${role}, Full Stack Web Development (MERN), React.js/Frontend Development, Node.js/Backend Development, or Junior Software Engineering.`
    : "I’m reaching out to enquire about suitable entry-level or junior opportunities at " +
      `${company} in Full Stack Web Development (MERN), React.js/Frontend Development, Node.js/Backend Development, or Junior Software Engineering.`;

  const companyAwareRoleLine = role
    ? roleLine.replace(
        "opportunities related to",
        `opportunities at ${company} related to`
      )
    : roleLine;

  const body = `Dear ${firstName},

I hope you are doing well. ${companyAwareRoleLine} If you are not the right contact for these roles, I would appreciate it if you could direct me to the relevant recruiter or team.

${MY_DETAILS.profileSummary}

My core skills include ${MY_DETAILS.coreSkills}. I would be grateful to be considered for a suitable current or upcoming opportunity. I have included my resume with this email for your review.

Thank you for your time and consideration. I look forward to hearing from you.

Best regards,
${MY_DETAILS.name}
Phone: ${MY_DETAILS.phone}
Email: ${MY_DETAILS.email}
GitHub: ${MY_DETAILS.github}
LinkedIn: ${MY_DETAILS.linkedin}`;

  return { subject, body };
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP configuration is incomplete. Check SMTP_HOST, SMTP_USER, and SMTP_PASS in .env."
    );
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function validateContact(contact) {
  const email = String(contact.email || "").trim();
  const company = String(contact.company || "").trim();

  // Basic format check. The email provider will perform its own validation too.
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    return "Invalid or missing email address";
  }

  if (!company) {
    return "Missing company name";
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askNumber(rl, message, min, max) {
  while (true) {
    const answer = (await rl.question(message)).trim();
    const number = Number(answer);

    if (
      answer !== "" &&
      Number.isInteger(number) &&
      number >= min &&
      number <= max
    ) {
      return number;
    }

    console.log(`Enter a whole number between ${min} and ${max}.`);
  }
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const contacts = loadContacts();
    const log = loadLog();

    console.log(`\nContacts available: ${contacts.length}`);
    console.log("Row 1 means the first contact after the CSV header.");
    console.log(`Daily successful-send limit: ${DAILY_LIMIT}`);
    console.log(`Successfully sent today: ${sentToday(log)}`);
    console.log(`Mode: ${SEND_EMAILS ? "SEND EMAILS" : "PREVIEW ONLY"}\n`);

    const from = await askNumber(
      rl,
      "Starting row: ",
      1,
      contacts.length
    );

    const to = await askNumber(
      rl,
      "Ending row: ",
      from,
      contacts.length
    );

    const selected = contacts.slice(from - 1, to);

    if (selected.length === 0) {
      console.log("No contacts selected.");
      return;
    }

    console.log(`\nSelected ${selected.length} contact(s), rows ${from}-${to}.\n`);

    if (!fs.existsSync(RESUME_FILE)) {
      throw new Error(
        `Resume file not found: ${RESUME_FILE}. Put your PDF resume beside index.js.`
      );
    }

    // Preview mode never sends or changes any contact's send status.
    if (!SEND_EMAILS) {
      console.log("PREVIEW MODE: no emails will be sent.\n");

      for (let i = 0; i < selected.length; i++) {
        const contact = selected[i];
        const email = emailKey(contact.email);
        const { subject, body } = createEmail(contact);
        const validationError = validateContact(contact);

        console.log("--------------------------------------------------");
        console.log(`Row: ${from + i}`);
        console.log(`To: ${email || "(missing email)"}`);
        console.log(`Company: ${contact.company || "(missing company)"}`);

        if (validationError) {
          console.log(`WARNING: ${validationError}`);
        }

        if (log[email]?.status === "sent") {
          console.log("STATUS: Already sent; would be skipped.");
        }

        console.log(`Subject: ${subject}\n`);
        console.log(body);
        console.log("");
      }

      console.log(
        "\nPreview complete. To send emails, set SEND_EMAILS=true in .env and run the script again."
      );
      return;
    }

    const alreadySent = selected.filter(
      (contact) => log[emailKey(contact.email)]?.status === "sent"
    ).length;

    console.log(`Already sent in this selection: ${alreadySent}`);
    console.log(`Resume attachment: ${RESUME_FILE}`);
    console.log(
      "\nIMPORTANT: The script records emails accepted by the SMTP server. This does not guarantee inbox delivery."
    );

    const confirmation = (
      await rl.question('\nType SEND to begin sending: ')
    )
      .trim()
      .toUpperCase();

    if (confirmation !== "SEND") {
      console.log("Cancelled. No emails were sent.");
      return;
    }

    const transporter = createTransporter();

    console.log("\nVerifying SMTP connection...");

    await transporter.verify();

    console.log("SMTP connection verified.\n");

    let sentThisRun = 0;
    let skipped = 0;
    let failed = 0;
    let limitReached = false;

    for (let i = 0; i < selected.length; i++) {
      const contact = selected[i];
      const rowNumber = from + i;
      const email = emailKey(contact.email);

      if (!email) {
        console.log(`[Row ${rowNumber}] SKIPPED: Missing email.`);
        skipped++;
        continue;
      }

      // Do not resend an address already recorded as successfully sent.
      if (log[email]?.status === "sent") {
        console.log(`[Row ${rowNumber}] SKIPPED: Already sent to ${email}`);
        skipped++;
        continue;
      }

      const validationError = validateContact(contact);

      if (validationError) {
        console.log(`[Row ${rowNumber}] SKIPPED: ${validationError}.`);
        skipped++;
        continue;
      }

      // Re-check the daily cap before each email.
      if (sentToday(log) >= DAILY_LIMIT) {
        console.log(
          `\nDaily limit of ${DAILY_LIMIT} successful sends reached. Stopping.`
        );
        limitReached = true;
        break;
      }

      const { subject, body } = createEmail(contact);

      const senderName =
        process.env.SENDER_NAME || MY_DETAILS.name;

      const senderEmail =
        process.env.SENDER_EMAIL || process.env.SMTP_USER;

      if (!senderEmail) {
        throw new Error(
          "Set SENDER_EMAIL or SMTP_USER in your .env file."
        );
      }

      console.log(
        `[${rowNumber}/${to}] Sending to ${email} (${contact.company})...`
      );

      try {
        const info = await transporter.sendMail({
          from: {
            name: senderName,
            address: senderEmail,
          },
          to: email,
          subject,
          text: body,
          attachments: [
            {
              filename: path.basename(RESUME_FILE),
              path: RESUME_FILE,
              contentType: "application/pdf",
            },
          ],
        });

        log[email] = {
          status: "sent",
          name: String(contact.name || "").trim(),
          company: String(contact.company || "").trim(),
          messageId: info.messageId || null,
          timestamp: new Date().toISOString(),
        };

        // Persist after every successful send so progress survives a crash.
        saveLog(log);

        sentThisRun++;

        console.log(
          `SUCCESS: SMTP accepted the message to ${email}. Message ID: ${info.messageId || "not provided"}`
        );
      } catch (error) {
        failed++;

        log[email] = {
          status: "failed",
          name: String(contact.name || "").trim(),
          company: String(contact.company || "").trim(),
          error: String(error.message || error),
          timestamp: new Date().toISOString(),
        };

        // Persist failures too. Failed entries can be retried on a later run.
        try {
          saveLog(log);
        } catch (logError) {
          console.error(
            "CRITICAL: Could not save the send history:",
            logError.message
          );
          throw logError;
        }

        console.error(`FAILED: ${email} — ${error.message}`);
      }

      // Wait between attempts, not after the final selected contact.
      if (i < selected.length - 1) {
        console.log("Waiting 10 seconds before the next contact...\n");
        await sleep(DELAY_MS);
      }
    }

    if (typeof transporter.close === "function") {
      transporter.close();
    }

    console.log("\n================ FINAL SUMMARY ================");
    console.log(`Selected: ${selected.length}`);
    console.log(`Successfully sent this run: ${sentThisRun}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`Successful sends today: ${sentToday(log)}`);
    console.log(`Daily limit: ${DAILY_LIMIT}`);
    console.log(`History file: ${LOG_FILE}`);

    if (limitReached) {
      console.log("Stopped because the daily successful-send limit was reached.");
    }

    console.log("================================================\n");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("\nMailer stopped:", error.message);
  process.exitCode = 1;
});
