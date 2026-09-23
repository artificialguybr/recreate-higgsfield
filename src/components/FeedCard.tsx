import type { FeedModel } from "../lib/hf";

// One card for all catalog data (home strip, explore, mode pages, studio).
export default function FeedCard({ m, onOpen }: { m: FeedModel; onOpen?: () => void }) {
  return (
    <button className="feed-cell" onClick={onOpen}>
      <span className="feed-media">
        {m.type === "video" && m.video ? (
          <video src={m.video} poster={m.thumb} muted loop playsInline autoPlay preload="metadata" />
        ) : (
          m.thumb && <img src={m.thumb} alt={m.title} loading="lazy" />
        )}
      </span>
      <span className="feed-foot">
        <b>{m.title}</b>
        <span>
          {m.company}
          {m.price ? (
            <>
              {" · "}
              {m.discount && m.priceOriginal ? <s>${m.priceOriginal}/{m.priceUnit}</s> : null}
              ${m.price}/{m.priceUnit}
            </>
          ) : null}
        </span>
      </span>
    </button>
  );
}
