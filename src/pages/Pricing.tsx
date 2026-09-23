import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "../components/Icons";

const PAYG = [
  "Billed per generation — from the live Higgsfield catalog",
  "Marketing Studio Image from $0.0121/img",
  "Kling 3.0 video from $0.042/s",
  "No subscriptions, no credits balance",
];

const UNLIMITED = [
  "Everything in pay-as-you-go",
  "Flat monthly rate, unlimited generations",
  "Priority rendering queue",
  "Rolling out to console accounts",
];

export default function Pricing() {
  const nav = useNavigate();
  const [soon, setSoon] = useState(false);

  return (
    <div className="app-scroll">
      <div className="page">
        <h1 className="page-title">Pricing</h1>
        <p className="page-sub">You pay for what you generate. Nothing else.</p>
        <div className="plans">
          <div className="plan featured">
            <div className="p-name">Pay as you go</div>
            <div className="p-price">$0<span> + usage</span></div>
            <div className="p-desc">Available models are priced per second or per image, with no subscription required.</div>
            <ul>
              {PAYG.map((f) => (
                <li key={f}>
                  <Check size={14} />
                  {f}
                </li>
              ))}
            </ul>
            <button className="p-cta" onClick={() => nav("/")}>
              Start creating
            </button>
          </div>
          <div className="plan">
            <div className="p-name">Unlimited</div>
            <div className="p-price">—<span> /month</span></div>
            <div className="p-desc">For teams generating every day.</div>
            <ul>
              {UNLIMITED.map((f) => (
                <li key={f}>
                  <Check size={14} />
                  {f}
                </li>
              ))}
            </ul>
            <button className="p-cta" onClick={() => setSoon(true)}>
              {soon ? "Rolling out soon" : "Go Unlimited"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
