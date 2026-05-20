const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "2468";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "complaints.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]\n", "utf8");
}

function readComplaints() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeComplaints(complaints) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(complaints, null, 2) + "\n", "utf8");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function publicComplaint(complaint) {
  const {
    reporterName,
    reporterPhone,
    reporterEmail,
    contactHash,
    ...safeComplaint
  } = complaint;
  return safeComplaint;
}

function requireAdmin(req, res) {
  const pin = req.headers["x-admin-pin"];
  if (pin !== ADMIN_PIN) {
    sendJson(res, 401, { error: "Admin PIN required" });
    return false;
  }
  return true;
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 600);
}

function makeComplaint(payload) {
  const now = new Date().toISOString();
  const reporterName = normalizeText(payload.reporterName, "Anonymous citizen").slice(0, 80);
  const reporterPhone = normalizeText(payload.reporterPhone).slice(0, 30);
  const reporterEmail = normalizeText(payload.reporterEmail).slice(0, 120);
  const contactHash = crypto
    .createHash("sha256")
    .update(`${reporterName}|${reporterPhone}|${reporterEmail}`)
    .digest("hex")
    .slice(0, 12);

  return {
    id: `CIV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
    title: normalizeText(payload.title, "Civic issue").slice(0, 120),
    category: normalizeText(payload.category, "Other").slice(0, 60),
    description: normalizeText(payload.description).slice(0, 800),
    address: normalizeText(payload.address).slice(0, 240),
    location: {
      lat: Number(payload.location?.lat || 0),
      lng: Number(payload.location?.lng || 0),
      accuracy: Number(payload.location?.accuracy || 0)
    },
    imageDataUrl: String(payload.imageDataUrl || "").slice(0, 8_000_000),
    completionImageDataUrl: "",
    reporterName,
    reporterPhone,
    reporterEmail,
    contactHash,
    status: "submitted",
    verified: false,
    assignedTo: "",
    workerNotes: "",
    officeNotes: "",
    timeline: [
      {
        at: now,
        label: "Complaint submitted",
        detail: "Citizen report received by municipal office."
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

function nextTimelineEntry(action, payload) {
  const at = new Date().toISOString();
  if (action === "assign") {
    return {
      at,
      label: "Worker assigned",
      detail: `${normalizeText(payload.assignedTo, "Field worker")} assigned for site visit.`
    };
  }
  if (action === "verify") {
    return {
      at,
      label: "Issue verified",
      detail: "Field team confirmed that the issue exists."
    };
  }
  if (action === "progress") {
    return {
      at,
      label: "Work in progress",
      detail: normalizeText(payload.workerNotes, "Repair or cleanup work has started.")
    };
  }
  if (action === "complete") {
    return {
      at,
      label: "Work completed",
      detail: normalizeText(payload.workerNotes, "Municipal team uploaded completion proof.")
    };
  }
  return {
    at,
    label: "Status updated",
    detail: normalizeText(payload.officeNotes, "Municipal office updated this complaint.")
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/public/complaints") {
    const complaints = readComplaints().map(publicComplaint);
    complaints.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJson(res, 200, complaints);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/complaints") {
    if (!requireAdmin(req, res)) return;
    const complaints = readComplaints().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJson(res, 200, complaints);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/complaints") {
    try {
      const payload = JSON.parse(await readBody(req));
      const complaints = readComplaints();
      const complaint = makeComplaint(payload);
      complaints.push(complaint);
      writeComplaints(complaints);
      sendJson(res, 201, publicComplaint(complaint));
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Could not create complaint" });
    }
    return;
  }

  const updateMatch = url.pathname.match(/^\/api\/admin\/complaints\/([^/]+)$/);
  if (req.method === "PATCH" && updateMatch) {
    if (!requireAdmin(req, res)) return;
    try {
      const id = decodeURIComponent(updateMatch[1]);
      const payload = JSON.parse(await readBody(req));
      const complaints = readComplaints();
      const index = complaints.findIndex((item) => item.id === id);
      if (index === -1) {
        sendJson(res, 404, { error: "Complaint not found" });
        return;
      }

      const complaint = complaints[index];
      const action = normalizeText(payload.action);

      if (action === "assign") {
        complaint.assignedTo = normalizeText(payload.assignedTo).slice(0, 120);
        complaint.status = "assigned";
      } else if (action === "verify") {
        complaint.verified = true;
        complaint.status = "verified";
      } else if (action === "progress") {
        complaint.status = "in_progress";
        complaint.workerNotes = normalizeText(payload.workerNotes).slice(0, 800);
      } else if (action === "complete") {
        complaint.status = "completed";
        complaint.verified = true;
        complaint.workerNotes = normalizeText(payload.workerNotes).slice(0, 800);
        complaint.completionImageDataUrl = String(payload.completionImageDataUrl || complaint.completionImageDataUrl).slice(0, 8_000_000);
      } else {
        complaint.officeNotes = normalizeText(payload.officeNotes).slice(0, 800);
      }

      complaint.updatedAt = new Date().toISOString();
      complaint.timeline.push(nextTimelineEntry(action, payload));
      complaints[index] = complaint;
      writeComplaints(complaints);
      sendJson(res, 200, complaint);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Could not update complaint" });
    }
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

ensureStore();

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Municipal Issue Portal running at http://localhost:${PORT}`);
  console.log(`Admin PIN: ${ADMIN_PIN}`);
});
