import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    // Legge la cartella "images" nella root del progetto
    const dirPath = path.join(process.cwd(), 'images');
    const files = fs.readdirSync(dirPath);
    
    // Filtra solo i file immagine (ignora eventuali file di sistema)
    const images = files.filter(file => /\.(jpg|jpeg|png|webp|gif)$/i.test(file));
    
    // Restituisce la lista delle foto
    res.status(200).json(images);
  } catch (error) {
    console.error('Errore lettura cartella images:', error);
    res.status(500).json({ error: 'Cartella images non trovata o vuota' });
  }
}
