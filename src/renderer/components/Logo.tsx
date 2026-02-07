import React from 'react';
import logoImage from '../assets/logo.png';

const Logo: React.FC = () => {
  return (
    <div className="logo-container">
      <img src={logoImage} alt="Statement Converter Logo" className="logo-image" />
    </div>
  );
};

export default Logo;
