import { Route, Routes } from "react-router";
import { Page } from "./components/Page";
import { catalog } from "./data";

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Page catalog={catalog} />} />
    </Routes>
  );
}
