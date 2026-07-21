import SourceCitation from "./SourceCitation";

function MessageBubble({ role, text, sources }) {
  return (
    <div className={`message ${role}`}>
      <p>{text}</p>
      {role === "bot" && <SourceCitation sources={sources} />}
    </div>
  );
}

export default MessageBubble;
