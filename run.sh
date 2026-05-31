docker run -d -p 3103:3000 \
  --restart unless-stopped \
  --name remindly \
  --env-file .env \
  -v /data/remindly:/app/data:rw \
  remindly
