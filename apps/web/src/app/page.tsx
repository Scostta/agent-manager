export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-4">Claude Cockpit</h1>
      <p className="text-gray-600 mb-8">
        Backend arrancado. El frontend está pendiente de construir.
      </p>
      <div className="rounded-lg border border-gray-200 p-6 bg-gray-50">
        <h2 className="text-lg font-semibold mb-2">Comprobación rápida</h2>
        <p className="text-sm text-gray-700">
          Comprueba que la API responde:{" "}
          <a
            href="http://localhost:3001/health"
            className="text-blue-600 underline"
            target="_blank"
            rel="noreferrer"
          >
            http://localhost:3001/health
          </a>
        </p>
        <p className="text-sm text-gray-700 mt-2">
          Debería devolver JSON con <code className="bg-gray-200 px-1">{"{ ok: true, time: ... }"}</code>.
        </p>
      </div>
    </main>
  );
}
