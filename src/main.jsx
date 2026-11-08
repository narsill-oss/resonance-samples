import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Home from './Home';
import Crm from './samples/Crm';
import Support from './samples/Support';
import Knowledge from './samples/Knowledge';
import Expenses from './samples/Expenses';
import Review from './samples/Review';
import Localize from './samples/Localize';
import Quarry from './samples/Quarry';
import Hiring from './samples/Hiring';

// Each app owns its whole page, as on the site: /samples/<slug>.
createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to="/samples" replace />} />
      <Route path="/samples" element={<Home />} />
      <Route path="/samples/crm" element={<Crm />} />
      <Route path="/samples/support" element={<Support />} />
      <Route path="/samples/knowledge" element={<Knowledge />} />
      <Route path="/samples/expenses" element={<Expenses />} />
      <Route path="/samples/review" element={<Review />} />
      <Route path="/samples/localize" element={<Localize />} />
      <Route path="/samples/data" element={<Quarry />} />
      <Route path="/samples/hiring" element={<Hiring />} />
      <Route path="*" element={<Navigate to="/samples" replace />} />
    </Routes>
  </BrowserRouter>,
);
