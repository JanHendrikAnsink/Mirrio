// src/main.jsx - Aktualisierte Version mit besserer Loading-Behandlung
import React from 'react'
import ReactDOM from 'react-dom/client'
import Mirrio from './mirrio.jsx'
import './index.css'

// Warte kurz bis CSS geladen ist
const root = ReactDOM.createRoot(document.getElementById('root'))

// Render App
root.render(
  <React.StrictMode>
    <Mirrio />
  </React.StrictMode>
)

// Entferne Loading-Klassen nach dem Rendern
setTimeout(() => {
  document.body.classList.add('loaded')
  const loader = document.getElementById('initial-loader')
  if (loader) {
    loader.remove()
  }
}, 0)

// Alternative: In mirrio.jsx am Anfang des useEffect für Auth:
/*
useEffect(() => {
  // Entferne Loader wenn App bereit
  document.body.classList.add('loaded');
  const loader = document.getElementById('initial-loader');
  if (loader) loader.remove();
  
  // Rest des Auth-Codes...
}, []);
*/