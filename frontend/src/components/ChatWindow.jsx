import { useState } from "react";
import MessageBubble from "./MessageBubble";
import { askQuestion } from "../api";

function ChatWindow() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const { answer, sources } = await askQuestion(question);
      setMessages((prev) => [...prev, { role: "bot", text: answer, sources }]);
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
      <div className="message-history">
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} text={m.text} sources={m.sources} />
        ))}
        {loading && <div className="message bot">Thinking...</div>}
      </div>

      <form onSubmit={handleSubmit} className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about hospital policies..."
        />
        <button type="submit" disabled={loading}>
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatWindow;
