const stages = [
  {
    name: "Ingest",
    detail: "Footage, audio, and source links",
    state: "ready",
  },
  {
    name: "Shape",
    detail: "Cuts, captions, and story structure",
    state: "next",
  },
  {
    name: "Package",
    detail: "Thumbnails, titles, and descriptions",
    state: "planned",
  },
  {
    name: "Publish",
    detail: "YouTube delivery and analytics",
    state: "connected",
  },
] as const;

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Media pipeline home">
          <span className="mark" aria-hidden="true">
            <i />
            <i />
          </span>
          Media pipeline
        </a>
        <div className="workspace-state">
          <span aria-hidden="true" />
          Local workspace
        </div>
      </header>

      <section className="intro" id="top">
        <div>
          <h1>One flow, from first frame to final upload.</h1>
        </div>
        <p className="lede">
          The web workspace is ready. Next, connect the tools that turn raw
          ideas into edited videos, sharp thumbnails, and published work.
        </p>
      </section>

      <section className="pipeline" aria-labelledby="pipeline-title">
        <div className="section-heading">
          <h2 id="pipeline-title">The working line</h2>
          <p>Built to grow one capability at a time.</p>
        </div>

        <ol className="track">
          {stages.map((stage, index) => (
            <li className={`stage stage-${stage.state}`} key={stage.name}>
              <div className="stage-index">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div>
                <h3>{stage.name}</h3>
                <p>{stage.detail}</p>
              </div>
              <span className="stage-state">
                {stage.state === "connected" ? "MCP available" : "Planned"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="next-build" aria-labelledby="next-build-title">
        <div className="thumbnail-frame" aria-hidden="true">
          <div className="frame-copy">
            <span>Thumbnail lab</span>
            <strong>Make the first impression count.</strong>
          </div>
          <div className="safe-area" />
          <div className="playhead" />
        </div>
        <div className="next-copy">
          <h2 id="next-build-title">Build the thumbnail generator next.</h2>
          <p>
            Start with a focused canvas for layouts, image treatments, and
            reusable channel styles. The monorepo is ready for shared media and
            UI packages when those boundaries become real.
          </p>
          <a href="https://nextjs.org/docs" target="_blank" rel="noreferrer">
            Read the Next.js docs
          </a>
        </div>
      </section>

      <footer>
        <span>youtube-media / apps/web</span>
        <span>Next.js + pnpm workspaces</span>
      </footer>
    </main>
  );
}
