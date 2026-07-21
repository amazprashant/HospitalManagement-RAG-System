import { useState } from "react";
import ChatWindow from "./components/ChatWindow";
import PatientLookup from "./components/PatientLookup";
import "./App.css";

function App() {
  const [tab, setTab] = useState("policies");

  return (
    <div className="app">
      <header>
        <h1>Hospital Assistant</h1>
        <p>Ask about hospital policies, or look up a patient's medications and history.</p>
      </header>

      <div className="tabs">
        <button
          className={tab === "policies" ? "active" : ""}
          onClick={() => setTab("policies")}
        >
          Hospital Policies
        </button>
        <button
          className={tab === "patients" ? "active" : ""}
          onClick={() => setTab("patients")}
        >
          Patient Lookup
        </button>
      </div>

      {tab === "policies" ? <ChatWindow /> : <PatientLookup />}
    </div>
  );
}

export default App;
