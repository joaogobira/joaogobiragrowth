'use client';

import { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';

interface SlidePreviewProps {
  htmlContent: string;
  width: number;
  height: number;
  scale?: number;
}

export default function SlidePreview({ htmlContent, width, height, scale = 0.25 }: SlidePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handleExportPng = async () => {
    if (!iframeRef.current || !iframeRef.current.contentDocument) return;
    
    // O html2canvas precisa rodar no body do iframe
    const iframeBody = iframeRef.current.contentDocument.body;
    
    try {
      const canvas = await html2canvas(iframeBody, {
        useCORS: true,
        scale: 2, // Maior resolução
        backgroundColor: '#111111',
        width: width,
        height: height,
        windowWidth: width,
        windowHeight: height,
      });
      
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      link.download = `criativo-${new Date().getTime()}.png`;
      link.click();
    } catch (err) {
      console.error('Erro ao exportar:', err);
      alert('Houve um erro ao tentar exportar a imagem. Veja o console.');
    }
  };

  const handleDownloadHtml = () => {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `criativo-${new Date().getTime()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div 
        ref={containerRef}
        className="relative border border-neutral-800 rounded shadow-xl overflow-hidden bg-[#111]"
        style={{ 
          width: width * scale, 
          height: height * scale 
        }}
      >
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          title="Slide Preview"
          className="absolute top-0 left-0 border-none pointer-events-none"
          style={{
            width: width,
            height: height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          sandbox="allow-same-origin allow-scripts"
        />
      </div>

      <div className="flex gap-3">
        <button 
          onClick={handleExportPng}
          className="px-4 py-2 bg-neutral-100 text-neutral-900 rounded font-medium hover:bg-white transition-colors text-sm"
        >
          Exportar PNG
        </button>
        <button 
          onClick={handleDownloadHtml}
          className="px-4 py-2 bg-neutral-800 text-white rounded font-medium hover:bg-neutral-700 transition-colors text-sm border border-neutral-700"
        >
          Baixar HTML
        </button>
      </div>
    </div>
  );
}
