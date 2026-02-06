import React from 'react';

const Logo: React.FC = () => {
  return (
    <div className="logo-container">
      <div className="logo-animals">
        <span className="logo-llama">🦙</span>
        <span className="logo-cat">🐱</span>
      </div>
      <div className="logo-text">
        <div className="logo-title">Statement</div>
        <div className="logo-subtitle">Converter</div>
      </div>
    </div>
  );
};

export default Logo;
