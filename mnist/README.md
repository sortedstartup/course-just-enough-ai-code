# Installing requirements
`pip install tensorflow matplotlib`
`export PATH=$PATH:/home/dev/.local/bin/`

# Running the training
`python3 mnist.py`

# Running tensorboard
`tensorboard --logdir=logs/fit`

# Viewing the saved model
`cd mnist_model`


# Serving the model (without using docker)

```
sudo echo "deb [arch=amd64] http://storage.googleapis.com/tensorflow-serving-apt stable tensorflow-model-server tensorflow-model-server-universal" | sudo tee /etc/apt/sources.list.d/tensorflow-serving.list && \
curl https://storage.googleapis.com/tensorflow-serving-apt/tensorflow-serving.release.pub.gpg | sudo apt-key add -

sudo apt-get update && sudo apt-get install tensorflow-model-server

# make sure you in the mnist directory while executing this step
tensorflow_model_server --rest_api_port=8501 --model_base_path="$(pwd)/mnist_model" --model_name=mnist

```