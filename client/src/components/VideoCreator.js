import React, { useState, useRef } from 'react';
import './VideoCreator.css';

// הגדרת כתובת השרת - תעדכן זאת אחרי הפריסה
const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://videocreatorai-server.onrender.com' // עדכן לכתובת השרת שלך
  : 'http://localhost:3001';

const VideoCreator = () => {
  const [loading, setLoading] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [audioText, setAudioText] = useState('');
  const [generatedImage, setGeneratedImage] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [audioData, setAudioData] = useState(null); // משתנה חדש לנתוני AudioData
  const [finalVideo, setFinalVideo] = useState(null);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  
  // יצירת תמונה
  const generateImage = async () => {
    if (!imagePrompt.trim()) {
      setError('יש להזין תיאור לתמונה');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/generate-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: imagePrompt }),
      });
      
      if (!response.ok) {
        throw new Error('שגיאה ביצירת התמונה');
      }
      
      const data = await response.json();
      setGeneratedImage(data.imageUrl);
      setStep(2);
    } catch (err) {
      setError(`שגיאה: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // יצירת אודיו
  const generateAudio = async () => {
    if (!audioText.trim()) {
      setError('יש להזין טקסט לקריינות');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/generate-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: audioText }),
      });
      
      if (!response.ok) {
        throw new Error('שגיאה ביצירת הקריינות');
      }
      
      const data = await response.json();
      if (data.audioUrl && data.success) {
        // שמור את שני הערכים - URL וגם Data URL
        setAudioFile(data.audioUrl);
        setAudioData(data.audioData); // שמירת הנתונים ב-Base64
        setStep(3);
      } else {
        throw new Error('לא התקבל קובץ אודיו תקין');
      }
    } catch (err) {
      setError(`שגיאה: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // יצירת וידאו - גרסה מעודכנת לפתרון בעיות CORS
  const createVideo = async () => {
    if (!generatedImage || (!audioFile && !audioData)) {
      setError('חסרים קבצים ליצירת הסרטון');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // טען את התמונה
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = generatedImage;
      });
      
      // הגדר את Canvas
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      
      // צייר את התמונה על ה-Canvas
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // יצירת זרם וידאו מה-Canvas
      const canvasStream = canvas.captureStream(30);
      
      // בדוק אם יש audioData (Base64) ושתמש בו במקום האודיו מהשרת
      let audio;
      if (audioData) {
        audio = new Audio(audioData);
      } else {
        audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.src = `${audioFile}?timestamp=${new Date().getTime()}`; // הוסף timestamp לעקיפת מטמון
      }
      
      audio.muted = false;
      
      // המתנה לטעינת האודיו
      await new Promise((resolve, reject) => {
        audio.oncanplaythrough = resolve;
        audio.onerror = (e) => {
          console.error("Audio load error:", e);
          reject(new Error('שגיאה בטעינת קובץ האודיו'));
        };
        audio.load();
      });
      
      const audioDuration = audio.duration;
      
      // שימוש ב-Web Audio API
      const audioContext = new AudioContext();
      await audioContext.resume();
      const audioSource = audioContext.createMediaElementSource(audio);
      const audioDestination = audioContext.createMediaStreamDestination();
      
      // חיבור מקור האודיו לשני יעדים: יעד הזרם ורמקולים
      audioSource.connect(audioDestination);
      audioSource.connect(audioContext.destination);
      
      // שילוב זרמי הוידאו והאודיו
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);
      
      // בדיקת רצועות
      console.log('Video tracks:', canvasStream.getVideoTracks().length);
      console.log('Audio tracks:', audioDestination.stream.getAudioTracks().length);
      
      // הגדרת MediaRecorder עם דחיסה טובה יותר
      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp8,opus',
        videoBitsPerSecond: 250000,
        audioBitsPerSecond: 128000
      });
      
      const chunks = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      
      // התחל את ההקלטה
      mediaRecorder.start(100);
      
      // נגן את האודיו
      audio.currentTime = 0;
      audio.play();
      
      // עדכון Canvas בכל פריים
      const drawFrame = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        if (audio.currentTime < audioDuration) {
          requestAnimationFrame(drawFrame);
        } else {
          mediaRecorder.stop();
          audio.pause();
          audioContext.close();
        }
      };
      
      drawFrame();
      
      // טיפול בסיום ההקלטה
      mediaRecorder.onstop = async () => {
        try {
          const videoBlob = new Blob(chunks, { type: 'video/webm; codecs=vp8,opus' });
          const reader = new FileReader();
          
          reader.onloadend = async () => {
            try {
              const base64data = reader.result;
              
              const response = await fetch(`${API_BASE_URL}/api/save-video`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ videoBlob: base64data })
              });
              
              if (!response.ok) {
                throw new Error('שגיאה בשמירת הסרטון');
              }
              
              const data = await response.json();
              if (data.success && data.videoUrl) {
                console.log("Video saved successfully:", data.videoUrl);
                setFinalVideo(data.videoUrl);
                setStep(4);
              } else {
                throw new Error('תגובה לא תקינה מהשרת');
              }
            } catch (error) {
              console.error('Error saving video:', error);
              setError(`שגיאה בשמירת הסרטון: ${error.message}`);
            } finally {
              setLoading(false);
            }
          };
          
          reader.onerror = () => {
            setError('שגיאה בקריאת הקובץ');
            setLoading(false);
          };
          
          reader.readAsDataURL(videoBlob);
        } catch (error) {
          console.error('Error creating video:', error);
          setError(`שגיאה ביצירת הסרטון: ${error.message}`);
          setLoading(false);
        }
      };
    } catch (err) {
      console.error('Error in video creation:', err);
      setError(`שגיאה: ${err.message}`);
      setLoading(false);
    }
  };
  
  // הורדת הסרטון
  const downloadVideo = () => {
    if (!finalVideo) {
      setError('אין סרטון להורדה');
      return;
    }
    
    const a = document.createElement('a');
    a.href = finalVideo;
    a.download = `generated-video-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  
  // שיתוף הסרטון
  const shareVideo = async () => {
    if (!finalVideo) {
      setError('אין סרטון לשיתוף');
      return;
    }
    
    const email = document.getElementById('email-input')?.value;
    if (!email) {
      setError('יש להזין כתובת אימייל');
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(finalVideo);
      const videoBlob = await response.blob();
      
      const formData = new FormData();
      formData.append('video', videoBlob, 'video.webm');
      formData.append('email', email);
      
      const shareResponse = await fetch(`${API_BASE_URL}/api/share-video`, {
        method: 'POST',
        body: formData,
      });
      
      if (!shareResponse.ok) {
        throw new Error('שגיאה בשיתוף הסרטון');
      }
      
      alert('הסרטון נשלח בהצלחה!');
    } catch (err) {
      setError(`שגיאה בשיתוף הסרטון: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // איפוס היוצר
  const resetCreator = () => {
    setImagePrompt('');
    setAudioText('');
    setGeneratedImage(null);
    setAudioFile(null);
    setAudioData(null);
    setFinalVideo(null);
    setStep(1);
    setError('');
    setLoading(false);
  };

  return (
    <div className="video-creator">
      <h2>יצירת סרטון אוטומטי</h2>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="step-indicator">
        <div className={`step ${step >= 1 ? 'active' : ''}`}>1. יצירת תמונה</div>
        <div className={`step ${step >= 2 ? 'active' : ''}`}>2. יצירת אודיו</div>
        <div className={`step ${step >= 3 ? 'active' : ''}`}>3. יצירת סרטון</div>
        <div className={`step ${step >= 4 ? 'active' : ''}`}>4. הורדה ושיתוף</div>
      </div>
      
      {step === 1 && (
        <div className="creation-step">
          <h3>שלב 1: יצירת תמונה</h3>
          <textarea
            className="prompt-input"
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            placeholder="תאר את התמונה שתרצה ליצור..."
            rows={4}
          />
          <button 
            className="action-button"
            onClick={generateImage}
            disabled={loading}
          >
            {loading ? 'מעבד...' : 'יצירת תמונה'}
          </button>
        </div>
      )}
      
      {step === 2 && (
        <div className="creation-step">
          <h3>שלב 2: יצירת אודיו</h3>
          {generatedImage && (
            <div className="preview-container">
              <img 
                src={generatedImage} 
                alt="Generated" 
                className="preview-image"
                crossOrigin="anonymous"
              />
            </div>
          )}
          <textarea
            className="text-input"
            value={audioText}
            onChange={(e) => setAudioText(e.target.value)}
            placeholder="הזן טקסט להקראה..."
            rows={4}
          />
          <button 
            className="action-button"
            onClick={generateAudio}
            disabled={loading}
          >
            {loading ? 'מעבד...' : 'יצירת אודיו'}
          </button>
        </div>
      )}
      
      {step === 3 && (
        <div className="creation-step">
          <h3>שלב 3: יצירת סרטון</h3>
          <div className="preview-row">
            {generatedImage && (
              <div className="preview-container">
                <img 
                  src={generatedImage} 
                  alt="Generated" 
                  className="preview-image"
                  crossOrigin="anonymous"
                />
                <p>התמונה שנוצרה</p>
              </div>
            )}
            {(audioFile || audioData) && (
              <div className="preview-container">
                <audio 
                  ref={audioRef}
                  controls 
                  src={audioData || audioFile} 
                  className="preview-audio"
                  crossOrigin="anonymous"
                />
                <p>האודיו שנוצר</p>
              </div>
            )}
          </div>
          <button 
            className="action-button"
            onClick={createVideo}
            disabled={loading}
          >
            {loading ? 'מעבד...' : 'יצירת סרטון'}
          </button>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      )}
      
      {step === 4 && (
        <div className="creation-step">
          <h3>שלב 4: הורד ושתף את הסרטון</h3>
          {finalVideo && (
            <div className="final-video-container">
              <video 
                ref={videoRef} 
                controls 
                src={finalVideo} 
                className="final-video"
                crossOrigin="anonymous"
              />
            </div>
          )}
          <div className="action-buttons">
            <button className="action-button download-btn" onClick={downloadVideo}>
              הורד סרטון
            </button>
            <div className="share-container">
              <input 
                type="email" 
                id="email-input" 
                placeholder="הזן כתובת אימייל לשיתוף" 
                className="email-input"
              />
              <button className="action-button share-btn" onClick={shareVideo} disabled={loading}>
                {loading ? 'שולח...' : 'שתף בדוא״ל'}
              </button>
            </div>
          </div>
          <button className="reset-button" onClick={resetCreator}>
            התחל מחדש
          </button>
        </div>
      )}
    </div>
  );
};

export default VideoCreator;