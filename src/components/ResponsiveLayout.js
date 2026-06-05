// src/components/ResponsiveLayout.js
import React from 'react';

const ResponsiveLayout = ({ children }) => {
  return (
    <div className="responsive-layout">
      {children}
    </div>
  );
};

export default ResponsiveLayout;