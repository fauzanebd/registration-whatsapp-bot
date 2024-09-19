require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { google } = require("googleapis");

// Initialize the WhatsApp client with local authentication
const client = new Client({
  authStrategy: new LocalAuth(),
});

// Set up Google Sheets API
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Function to extract spreadsheet ID from URL or return the ID if it's already in correct format
function getSpreadsheetId(urlOrId) {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId;
}

const spreadsheetId = getSpreadsheetId(process.env.GOOGLE_SHEETS_ID);
const registrationKeyword = process.env.REGISTRATION_KEYWORD || "daftar";

// Function to append data to Google Sheets
async function appendToSheet(data) {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1", // Adjust if your sheet has a different name
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [data],
      },
    });
    console.log("Data appended successfully");
  } catch (error) {
    console.error("Error appending data to sheet:", error);
  }
}

// Generate QR code for WhatsApp Web
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

// When the client is ready, log it to the console
client.on("ready", () => {
  console.log("Client is ready!");
});

// Listen for incoming messages
client.on("message", async (message) => {
  console.log(`Received message: ${message.body}`);

  // Check if the message ends with the registration keyword
  if (message.body.toLowerCase().endsWith(registrationKeyword.toLowerCase())) {
    const parts = message.body.split("_");
    if (parts.length === 4) {
      const [name, address, phoneNumber, keyword] = parts;
      await appendToSheet([name, address, phoneNumber]);
    } else {
      console.log("Invalid message format, ignoring.");
    }
  } else {
    console.log(
      `Message does not end with "${registrationKeyword}", ignoring.`
    );
  }
});

// Initialize the client
client.initialize();
