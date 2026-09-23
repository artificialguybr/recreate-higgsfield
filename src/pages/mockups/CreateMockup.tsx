import Composer from "../../components/Composer";

const MOCK_PROMPT = "Minimal white wristwatch on a pale surface, soft studio light, quiet product photography.";

export default function CreateMockup() {
  return (
    <div className="app-scroll">
      <div className="create-hub create-centered">
        <header className="hub-head hub-head-quiet">
          <div className="hub-eyebrow"><span className="hub-dot" /> Create / first take</div>
        </header>

        <main className="creation-card surface-create">
          <div className="creation-card-head creation-card-head-centered">
            <div>
              <h1>Yours to create.</h1>
              <p>One prompt. A clear first take.</p>
            </div>
          </div>

          <Composer
            model="Marketing Studio Image"
            initialMode="Image"
            prompt={MOCK_PROMPT}
            mockup
          />
        </main>
      </div>
    </div>
  );
}
