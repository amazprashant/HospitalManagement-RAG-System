function SourceCitation({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <ul className="sources">
      {sources.map((s, i) => (
        <li key={i}>
          Source: {s.file} (chunk {s.chunk}, similarity {s.similarity})
        </li>
      ))}
    </ul>
  );
}

export default SourceCitation;
