FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN HTTP_PROXY="" HTTPS_PROXY="" http_proxy="" https_proxy="" pip install --no-cache-dir -r requirements.txt
COPY gemini_web2api/ ./gemini_web2api/
COPY gemini_web2api.py ./gemini_web2api.py
COPY config.example.json ./config.json
EXPOSE 8081

CMD ["python", "-m", "gemini_web2api", "--config", "/app/config.json"]
