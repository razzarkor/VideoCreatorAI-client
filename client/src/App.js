import React, { useState } from 'react';
import './App.css';
import VideoCreator from './components/VideoCreator';
import Header from './components/Header';
import Footer from './components/Footer';

function App() {
  return (
    <div className="app-container">
      <Header />
      <main className="main-content">
        <VideoCreator />
      </main>
      <Footer />
    </div>
  );
}

export default App;
