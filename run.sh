docker run -d -p 3103:3000 \
  --restart unless-stopped \
  --name remindly \
  --network hermes-net \
  --env-file .env \
  -e LOGO_LINK_URL \
  -v /data/remindly:/app/data:rw \
  remindly
