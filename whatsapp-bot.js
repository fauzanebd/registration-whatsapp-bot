require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { google } = require("googleapis");
const crypto = require("crypto");
const axios = require("axios");
const qr = require("qrcode");

// Initialize the WhatsApp client with local authentication
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
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
const encryptionKey = crypto
  .createHash("sha256")
  .update(String(process.env.ENCRYPTION_KEY))
  .digest("base64")
  .slice(0, 32);
const awsPublicIp = process.env.AWS_PUBLIC_IP;
const attendantLimit = process.env.ATTENDANT_LIMIT || 80;

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(encryptionKey),
    iv
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

async function getRowCount() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1!A:A",
  });
  return response.data.values ? response.data.values.length : 0;
}

// Function to check if phone number already exists
async function isPhoneNumberRegistered(phoneNumber) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Sheet1!C:C", // Assuming phone numbers are in column C
    });

    const phoneNumbers = response.data.values
      ? response.data.values.flat()
      : [];
    return phoneNumbers.includes(phoneNumber);
  } catch (error) {
    console.error("Error checking phone number:", error);
    return false;
  }
}

// Function to append data to Google Sheets
async function appendToSheet(data) {
  try {
    const [name, address, phoneNumber] = data;

    // Check if phone number is already registered
    if (await isPhoneNumberRegistered(phoneNumber)) {
      console.log(`Phone number ${phoneNumber} is already registered`);
      return {
        success: false,
        message: `Peserta dengan nomor whatsapp ${phoneNumber} telah terdaftar`,
      };
    }

    const rowCount = await getRowCount();
    if (rowCount >= attendantLimit + 1) {
      return {
        success: false,
        message: "Maaf, kuota peserta nobar telah terpenuhi",
      };
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [data],
      },
    });

    const encryptedData = encrypt(data.join("|"));
    const verificationUrl = `http://${awsPublicIp}/registration-verification/${encodeURIComponent(
      encryptedData
    )}`;
    console.log("Verification URL:", verificationUrl);
    const qrCodeImage = await qr.toDataURL(verificationUrl);

    console.log("Data appended successfully");
    return { success: true, qrCodeImage };
  } catch (error) {
    console.error("Error appending data to sheet:", error);
    return {
      success: false,
      message: "Terjadi kesalahan, silakan coba lagi nanti",
    };
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
      const [name, address, phoneNumber, _] = parts;
      const result = await appendToSheet([name, address, phoneNumber]);

      if (result.success) {
        // const media = await client.createMediaFromBase64(result.qrCodeImage);
        const media = new MessageMedia(
          "image/png",
          result.qrCodeImage.split(",")[1]
        );
        await message.reply(media);
        // await client.sendMessage(message.from, media);
      } else {
        await message.reply(result.message);
      }
    } else {
      await message.reply(
        "Format pesan tidak valid. Gunakan: nama_alamat_nomortelpon_daftar"
      );
    }
  } else {
    console.log(
      `Message does not end with "${registrationKeyword}", ignoring.`
    );
  }
});

// Initialize the client
client.initialize();
