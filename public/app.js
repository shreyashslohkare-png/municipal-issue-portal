const state = {
  complaints: [],
  adminComplaints: [],
  activeFilter: "all",
  location: null,
  adminPin: ""
};

const statusLabels = {
  submitted: "Submitted",
  assigned: "Assigned",
  verified: "Verified",
  in_progress: "In progress",
  completed: "Completed"
};

const statusClass = {
  submitted: "Submitted",
  assigned: "Assigned",
  verified: "Verified",
  in_progress: "In progress",
  completed: "Completed"
};

const statusOrder = ["submitted", "assigned", "verified", "in_progress", "completed"];

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function locationText(complaint) {
  const { lat, lng, accuracy } = complaint.location || {};
  if (!lat || !lng) return complaint.address || "Location not provided";
  const coords = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  const extra = accuracy ? ` within ${Math.round(accuracy)}m` : "";
  return complaint.address ? `${complaint.address} (${coords}${extra})` : `${coords}${extra}`;
}

function mapLink(complaint) {
  const { lat, lng } = complaint.location || {};
  if (!lat || !lng) return "";
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadPublicComplaints() {
  state.complaints = await api("/api/public/complaints");
  renderPublic();
  renderMetrics();
}

function renderMetrics() {
  const total = state.complaints.length;
  const verified = state.complaints.filter((item) => item.verified).length;
  const progress = state.complaints.filter((item) => item.status === "in_progress").length;
  const completed = state.complaints.filter((item) => item.status === "completed").length;
  $("#metricSubmitted").textContent = total;
  $("#metricVerified").textContent = verified;
  $("#metricProgress").textContent = progress;
  $("#metricCompleted").textContent = completed;
  $("#heroCount").textContent = `${state.complaints.filter((item) => item.status !== "completed").length} active`;
}

function renderPublic() {
  const list = $("#publicList");
  const template = $("#complaintTemplate");
  list.innerHTML = "";

  const visible = state.complaints.filter((item) => {
    if (state.activeFilter === "all") return true;
    return item.status === state.activeFilter;
  });

  if (!visible.length) {
    list.innerHTML = `<div class="empty-state">No complaints in this view yet.</div>`;
    return;
  }

  visible.forEach((complaint) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".complaint-card");
    const image = node.querySelector(".image-wrap img");
    const status = node.querySelector(".status-badge");
    const completion = node.querySelector(".completion-proof");
    const completionImg = completion.querySelector("img");
    const location = node.querySelector(".location");
    const link = mapLink(complaint);
    const statusIndex = Math.max(0, statusOrder.indexOf(complaint.status));

    image.src = complaint.imageDataUrl || "";
    image.alt = `${complaint.category} issue photo`;
    status.textContent = statusLabels[complaint.status] || statusClass[complaint.status] || "Updated";
    node.querySelector("h3").textContent = complaint.title;
    node.querySelector(".category").textContent = complaint.category;
    node.querySelector(".description").textContent = complaint.description;
    node.querySelector(".id").textContent = complaint.id;
    location.innerHTML = link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(locationText(complaint))}</a>`
      : escapeHtml(locationText(complaint));
    node.querySelector(".assigned").textContent = complaint.assignedTo || "Not assigned";
    node.querySelector(".status-steps").innerHTML = statusOrder.map((step, index) => {
      const className = index < statusIndex ? "done" : index === statusIndex ? "current" : "";
      return `<span class="status-step ${className}" title="${escapeHtml(statusLabels[step])}"></span>`;
    }).join("");
    node.querySelector(".timeline").innerHTML = complaint.timeline.slice(-3).map((item) => `
      <div class="timeline-item">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(formatDate(item.at))} - ${escapeHtml(item.detail)}</span>
      </div>
    `).join("");

    if (complaint.completionImageDataUrl) {
      completion.classList.remove("hidden");
      completionImg.src = complaint.completionImageDataUrl;
    }

    card.dataset.status = complaint.status;
    list.appendChild(node);
  });
}

function attachFilters() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.activeFilter = button.dataset.filter;
      renderPublic();
    });
  });
}

function attachLocationCapture() {
  $("#captureLocation").addEventListener("click", () => {
    const status = $("#locationStatus");
    if (!navigator.geolocation) {
      status.textContent = "Your browser does not support geolocation.";
      return;
    }
    status.textContent = "Capturing location...";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        status.textContent = `Captured ${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)} within ${Math.round(state.location.accuracy)}m.`;
      },
      () => {
        status.textContent = "Location permission was denied. Add address manually.";
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function attachComplaintForm() {
  $("#complaintForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#formMessage");
    const file = $("#issuePhoto").files[0];

    if (!file) {
      message.textContent = "Please upload a photo.";
      return;
    }

    message.textContent = "Uploading complaint...";
    const formData = new FormData(form);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const payload = {
        title: formData.get("title"),
        category: formData.get("category"),
        description: formData.get("description"),
        reporterName: formData.get("reporterName"),
        reporterPhone: formData.get("reporterPhone"),
        address: formData.get("address"),
        location: state.location,
        imageDataUrl
      };
      const complaint = await api("/api/complaints", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      message.textContent = `Complaint submitted. Tracking ID: ${complaint.id}`;
      form.reset();
      state.location = null;
      $("#locationStatus").textContent = "Location not captured yet.";
      await loadPublicComplaints();
      location.hash = "#public";
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

async function loadAdminComplaints() {
  state.adminComplaints = await api("/api/admin/complaints", {
    headers: { "x-admin-pin": state.adminPin }
  });
  renderAdmin();
}

function renderAdmin() {
  const list = $("#adminList");
  list.innerHTML = "";

  const open = state.adminComplaints.filter((item) => item.status !== "completed").length;
  const assigned = state.adminComplaints.filter((item) => item.assignedTo && item.status !== "completed").length;
  const done = state.adminComplaints.filter((item) => item.status === "completed").length;
  $("#adminOpen").textContent = open;
  $("#adminAssigned").textContent = assigned;
  $("#adminDone").textContent = done;

  if (!state.adminComplaints.length) {
    list.innerHTML = `<div class="empty-state">No complaints yet.</div>`;
    return;
  }

  state.adminComplaints.forEach((complaint) => {
    const item = document.createElement("article");
    item.className = "admin-item";
    item.innerHTML = `
      <div class="admin-main">
        <header>
          <div>
            <strong>${escapeHtml(complaint.title)}</strong>
            <p>${escapeHtml(complaint.id)}</p>
          </div>
          <span class="queue-status ${escapeHtml(complaint.status)}">${escapeHtml(statusLabels[complaint.status] || complaint.status)}</span>
        </header>
        <p>${escapeHtml(complaint.description)}</p>
        <dl class="meta-list">
          <div><dt>Category</dt><dd>${escapeHtml(complaint.category)}</dd></div>
          <div><dt>Citizen contact</dt><dd>${escapeHtml(complaint.reporterName || "Anonymous")} / ${escapeHtml(complaint.reporterPhone || complaint.reporterEmail || "No contact")}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml(locationText(complaint))}</dd></div>
        </dl>
      </div>
      <div class="admin-controls">
        <label>
          Assign worker
          <input data-worker="${escapeHtml(complaint.id)}" value="${escapeHtml(complaint.assignedTo || "")}" placeholder="Worker name or team">
        </label>
        <div class="action-row">
          <button class="button secondary" data-action="assign" data-id="${escapeHtml(complaint.id)}" type="button">Assign</button>
          <button class="button secondary" data-action="verify" data-id="${escapeHtml(complaint.id)}" type="button">Verify</button>
          <button class="button secondary" data-action="progress" data-id="${escapeHtml(complaint.id)}" type="button">Start</button>
        </div>
        <label>
          Work notes
          <textarea data-notes="${escapeHtml(complaint.id)}" rows="3" placeholder="Add worker or office note">${escapeHtml(complaint.workerNotes || "")}</textarea>
        </label>
        <label>
          Completion photo
          <input data-complete-photo="${escapeHtml(complaint.id)}" type="file" accept="image/*">
        </label>
        <button class="button primary" data-action="complete" data-id="${escapeHtml(complaint.id)}" type="button">Complete with proof</button>
      </div>
    `;
    list.appendChild(item);
  });
}

async function updateComplaint(id, action) {
  const workerInput = document.querySelector(`[data-worker="${id}"]`);
  const notesInput = document.querySelector(`[data-notes="${id}"]`);
  const photoInput = document.querySelector(`[data-complete-photo="${id}"]`);
  const payload = {
    action,
    assignedTo: workerInput?.value || "",
    workerNotes: notesInput?.value || ""
  };

  if (action === "complete") {
    const file = photoInput?.files?.[0];
    if (!file) {
      alert("Please attach a completion photo.");
      return;
    }
    payload.completionImageDataUrl = await fileToDataUrl(file);
  }

  await api(`/api/admin/complaints/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "x-admin-pin": state.adminPin },
    body: JSON.stringify(payload)
  });
  await loadAdminComplaints();
  await loadPublicComplaints();
}

function attachAdmin() {
  $("#adminLogin").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.adminPin = $("#adminPin").value || "";
    try {
      await loadAdminComplaints();
      $("#adminLogin").classList.add("hidden");
      $("#adminDashboard").classList.remove("hidden");
    } catch (error) {
      alert(error.message);
    }
  });

  $("#refreshAdmin").addEventListener("click", loadAdminComplaints);

  $("#adminList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    button.disabled = true;
    try {
      await updateComplaint(button.dataset.id, button.dataset.action);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function init() {
  attachFilters();
  attachLocationCapture();
  attachComplaintForm();
  attachAdmin();
  await loadPublicComplaints();
}

init().catch((error) => {
  console.error(error);
  $("#publicList").innerHTML = `<div class="empty-state">${error.message}</div>`;
});
