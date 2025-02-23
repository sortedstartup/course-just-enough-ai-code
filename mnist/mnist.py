import tensorflow as tf
from tensorflow.keras import layers, models
import numpy as np
import os

# Hyperparameters
INPUT_SHAPE = (28 * 28,)
HIDDEN_LAYER_1_UNITS = 128
HIDDEN_LAYER_2_UNITS = 64
OUTPUT_UNITS = 10
LEARNING_RATE = 0.001
EPOCHS = 10
BATCH_SIZE = 32
MODEL_SAVE_PATH = "mnist_model/1"

# Load the MNIST dataset
# x_train are the images
# y_train is the labelled dataset ( i.e the classes 0...9)
(x_train, y_train), (x_test, y_test) = tf.keras.datasets.mnist.load_data()

# Normalize the input images to [0, 1] range
# Prevents Large Weight Updates
x_train, x_test = x_train / 255.0, x_test / 255.0

# Flatten the images into vectors
x_train = x_train.reshape(-1, 28 * 28)
x_test = x_test.reshape(-1, 28 * 28)

# Set up TensorBoard logging
import datetime
log_dir = "logs/fit/" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
tensorboard_callback = tf.keras.callbacks.TensorBoard(log_dir=log_dir, histogram_freq=1)

# Build the model
model = models.Sequential([
    layers.Input(shape=INPUT_SHAPE),
    layers.Dense(HIDDEN_LAYER_1_UNITS, activation='relu'),
    layers.Dense(HIDDEN_LAYER_2_UNITS, activation='relu'),
    layers.Dense(OUTPUT_UNITS, activation='softmax')
])

# Compile the model
optimizer = tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE)
model.compile(optimizer=optimizer,
              loss='sparse_categorical_crossentropy',
              metrics=['accuracy'])

# Train the model with TensorBoard callback
model.fit(x_train, y_train, epochs=EPOCHS, batch_size=BATCH_SIZE, validation_data=(x_test, y_test),
          callbacks=[tensorboard_callback])

# Evaluate the model on test data
test_loss, test_acc = model.evaluate(x_test, y_test, verbose=2)
print("\nTest accuracy:", test_acc)

# Save the trained model in TensorFlow SavedModel format for serving
os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
tf.saved_model.save(model, MODEL_SAVE_PATH)
print(f"Model saved at {MODEL_SAVE_PATH}")

# Instructions to launch TensorBoard
print("Run the following command in terminal to view TensorBoard:")
print("tensorboard --logdir=logs/fit")
