import { Route, Routes } from "react-router-dom";
import TopNav from "./components/TopNav";
import Home from "./pages/Home";
import Create from "./pages/Create";
import Explore from "./pages/Explore";
import Supercomputer from "./pages/Supercomputer";
import Pricing from "./pages/Pricing";
import Editor from "./pages/Editor";
import Launchframe from "./pages/Launchframe";
import Workspace from "./pages/Workspace";
import Assets from "./pages/Assets";

export default function App() {
  return (
    <div className="app">
      <TopNav />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/image" element={<Create mode="Image" />} />
          <Route path="/video" element={<Create mode="Video" />} />
          <Route path="/audio" element={<Create mode="Audio" />} />
          <Route path="/3d" element={<Create mode="3D" />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/effects" element={<Home initialSurface="effects" />} />
          <Route path="/studio" element={<Home initialSurface="studio" />} />
          <Route path="/chat" element={<Supercomputer />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/launch" element={<Launchframe />} />
          <Route path="/launchframe" element={<Launchframe />} />
          <Route path="/workspace" element={<Workspace />} />
        </Routes>
      </main>
    </div>
  );
}
