#!/bin/bash
# Sync renewed certificates to project directory and restart docker
cp /etc/letsencrypt/live/www.herkulesgroup-china.com/fullchain.pem /home/ubuntu/calendar-app/proxy/certs/
cp /etc/letsencrypt/live/www.herkulesgroup-china.com/privkey.pem /home/ubuntu/calendar-app/proxy/certs/
docker-compose -f /home/ubuntu/calendar-app/docker-compose.yml restart proxy