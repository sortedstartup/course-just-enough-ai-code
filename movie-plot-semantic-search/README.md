# Running API
```
export CLOUDFLARE_API_TOKEN=<>
export CLOUDFLARE_ACCOUNT_ID=<>
export POSTGRES_HOST=127.0.0.1
export POSTGRES_DB=postgres
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=postgres
```

# Running PG Vector
`docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg17`

# Running the API server

```
# This will install dependencies
npm install
```

```
# This will start the web app server
npm run dev
```
