const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

export async function askQuestion(question) {
  const res = await fetch(`${API_BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    throw new Error("Failed to get an answer");
  }

  return res.json();
}

export async function listPatients() {
  const res = await fetch(`${API_BASE}/api/patients`);
  if (!res.ok) {
    throw new Error("Failed to load patients");
  }
  return res.json();
}

export async function getPatient(patientId) {
  const res = await fetch(`${API_BASE}/api/patients/${patientId}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error("Failed to load patient");
  }
  return res.json();
}

export async function askPatientQuestion(patientId, question) {
  const res = await fetch(`${API_BASE}/api/patients/${patientId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    throw new Error("Failed to get an answer");
  }

  return res.json();
}
