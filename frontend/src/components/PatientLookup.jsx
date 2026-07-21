import { useEffect, useState } from "react";
import { listPatients, getPatient, askPatientQuestion } from "../api";

function PatientLookup() {
  const [patients, setPatients] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchId, setSearchId] = useState("");
  const [searchError, setSearchError] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    listPatients()
      .then((data) => setPatients(data.patients))
      .catch(() => setLoadError(true));
  }, []);

  function selectPatient(id, patientSummary) {
    setSelectedId(String(id));
    setSelectedPatient(patientSummary);
    setMessages([]);
    setSearchError("");
  }

  function handlePatientChange(e) {
    const id = e.target.value;
    const patient = patients.find((p) => String(p.id) === id) || null;
    setSearchId("");
    selectPatient(id, patient);
  }

  async function handleSearchSubmit(e) {
    e.preventDefault();
    const id = searchId.trim();
    if (!id) return;

    setSearchError("");
    try {
      const profile = await getPatient(id);
      if (!profile) {
        setSearchError(`No patient found with ID ${id}.`);
        return;
      }
      selectPatient(profile.patient.id, profile.patient);
    } catch (err) {
      setSearchError("Failed to search for patient.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || !selectedId || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const { answer } = await askPatientQuestion(selectedId, question);
      setMessages((prev) => [...prev, { role: "bot", text: answer }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "Something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-window">
      <form onSubmit={handleSearchSubmit} className="patient-search">
        <label htmlFor="patient-id-search">Search by ID:</label>
        <input
          id="patient-id-search"
          type="number"
          min="1"
          value={searchId}
          onChange={(e) => setSearchId(e.target.value)}
          placeholder="e.g. 7"
        />
        <button type="submit">Find</button>
        {searchError && <span className="error-text">{searchError}</span>}
      </form>

      <div className="patient-select">
        <label htmlFor="patient">Or select:</label>
        <select id="patient" value={selectedId} onChange={handlePatientChange}>
          <option value="">-- Select a patient --</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (ID {p.id}, {p.age}, {p.gender})
            </option>
          ))}
        </select>
        {loadError && <span className="error-text">Failed to load patients.</span>}
      </div>

      {selectedPatient && (
        <div className="patient-summary">
          Viewing: <strong>{selectedPatient.name}</strong> (ID {selectedPatient.id}, {selectedPatient.age}, {selectedPatient.gender})
        </div>
      )}

      <div className="message-history">
        {!selectedId && (
          <div className="message bot">Search by patient ID or select a patient above, then ask about their medications or medical history.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <p>{m.text}</p>
          </div>
        ))}
        {loading && <div className="message bot">Thinking...</div>}
      </div>

      <form onSubmit={handleSubmit} className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this patient's medication or diseases..."
          disabled={!selectedId}
        />
        <button type="submit" disabled={loading || !selectedId}>
          Send
        </button>
      </form>
    </div>
  );
}

export default PatientLookup;
