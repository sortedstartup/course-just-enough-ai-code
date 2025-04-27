import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';

const app = express();
const PORT = 3001;

// TensorFlow Serving URL
const TENSORFLOW_SERVING_URL = 'http://localhost:8501/v1/models/mnist:predict';

// Middleware to parse JSON and URL-encoded body
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // Add this line

// Serve static files from the "public" directory
app.use(express.static('public'));

// Route to handle predictions
app.post('/predict', async (req, res) => {
  console.log("/predict");
  try {
    const pixels = JSON.parse(req.body.pixels);
    
    console.log('Pixel array length:', pixels.length);
    
    // Send to TensorFlow Serving with correct input format
    const response = await axios.post(TENSORFLOW_SERVING_URL, {
      inputs: pixels  // Changed from instances to inputs
    });

    // Updated response handling
    const predictions = response.data.outputs.predictions[0];
    const predictedDigit = predictions.indexOf(Math.max(...predictions));

    console.log('Predicted digit:', predictedDigit);
    res.json({ digit: predictedDigit });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to process the prediction' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});