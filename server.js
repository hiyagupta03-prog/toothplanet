const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "appointments.json");

// ── Ensure data directory exists ──────────────────────────────────────────────
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ appointments: [] }, null, 2));
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off for inline scripts
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// Rate limiter for booking API
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { success: false, message: "Too many requests. Please try again later." },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { appointments: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function validateAppointment({ firstName, lastName, phone, service, date, time }) {
  if (!firstName || firstName.trim().length < 2) return "First name must be at least 2 characters.";
  if (!lastName || lastName.trim().length < 2) return "Last name must be at least 2 characters.";
  if (!phone || !/^[6-9]\d{9}$/.test(phone.replace(/\s/g, "")))
    return "Please enter a valid 10-digit Indian mobile number.";
  if (!service) return "Please select a service.";
  if (!date) return "Please select a preferred date.";
  if (!time) return "Please select a preferred time.";
  const selected = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selected < today) return "Please select a future date.";
  return null;
}

// ── API Routes ────────────────────────────────────────────────────────────────

// POST /api/appointments — book a new appointment
app.post("/api/appointments", bookingLimiter, (req, res) => {
  const { firstName, lastName, phone, email, service, date, time, message } = req.body;

  const error = validateAppointment({ firstName, lastName, phone, service, date, time });
  if (error) return res.status(400).json({ success: false, message: error });

  const data = readData();
  const appointment = {
    id: uuidv4(),
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: phone.trim(),
    email: email ? email.trim() : "",
    service,
    date,
    time,
    message: message ? message.trim() : "",
    status: "pending",      // pending | confirmed | cancelled
    bookedAt: new Date().toISOString(),
  };

  data.appointments.push(appointment);
  writeData(data);

  console.log(`[NEW APPOINTMENT] ${appointment.firstName} ${appointment.lastName} — ${service} on ${date} at ${time}`);

  return res.status(201).json({
    success: true,
    message: `Appointment booked successfully! Our team will contact you at ${phone} to confirm.`,
    appointmentId: appointment.id,
  });
});

// GET /api/appointments — list all (admin view)
app.get("/api/appointments", (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== (process.env.ADMIN_KEY || "toothplanet-admin-2025")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  const data = readData();
  const sorted = [...data.appointments].sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt));
  return res.json({ success: true, total: sorted.length, appointments: sorted });
});

// PATCH /api/appointments/:id — update status
app.patch("/api/appointments/:id", (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== (process.env.ADMIN_KEY || "toothplanet-admin-2025")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  const { status } = req.body;
  if (!["pending", "confirmed", "cancelled"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status." });
  }
  const data = readData();
  const appt = data.appointments.find((a) => a.id === req.params.id);
  if (!appt) return res.status(404).json({ success: false, message: "Appointment not found." });
  appt.status = status;
  appt.updatedAt = new Date().toISOString();
  writeData(data);
  return res.json({ success: true, message: `Status updated to ${status}.`, appointment: appt });
});

// DELETE /api/appointments/:id
app.delete("/api/appointments/:id", (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== (process.env.ADMIN_KEY || "toothplanet-admin-2025")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  const data = readData();
  const idx = data.appointments.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Not found." });
  data.appointments.splice(idx, 1);
  writeData(data);
  return res.json({ success: true, message: "Appointment deleted." });
});

// GET /api/availability — get booked slots for a date
app.get("/api/availability", (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ success: false, message: "Date required." });
  const data = readData();
  const booked = data.appointments
    .filter((a) => a.date === date && a.status !== "cancelled")
    .map((a) => a.time);
  return res.json({ success: true, date, bookedSlots: booked });
});

// GET /health
app.get("/health", (req, res) =>
  res.json({ status: "ok", clinic: "Tooth Planet Dental Care Clinic", uptime: process.uptime() })
);

// Fallback → serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🦷  Tooth Planet server running on http://localhost:${PORT}`);
  console.log(`📋  Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`📡  API: http://localhost:${PORT}/api/appointments\n`);
});
