FROM public.ecr.aws/docker/library/node:20.4.0-alpine@sha256:8165161b6e06ec092cf5d02731e8559677644845567dbe41b814086defc8c261

# Install Chrome and tini
USER root
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/main" > /etc/apk/repositories \
    && echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
    && echo "http://dl-cdn.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories \
    && echo "http://dl-cdn.alpinelinux.org/alpine/v3.12/main" >> /etc/apk/repositories \
    && apk upgrade -U -a \
    && apk add \
    libstdc++ \
    chromium \
    harfbuzz \
    nss \
    freetype \
    ttf-freefont \
    font-noto-emoji \
    wqy-zenhei \
    && rm -rf /var/cache/* \
    && mkdir /var/cache/apk

COPY local.conf /etc/fonts/local.conf

# Playwright
ENV CHROME_BIN=/usr/bin/chromium-browser \
    CHROME_PATH=/usr/lib/chromium/ \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    APP_HOME=/var/www/html

# Install node, tini
USER root
RUN apk add --no-cache tini nodejs nodejs-npm

# Add node user
RUN mkdir -p $APP_HOME \
    && chown -R node:node $APP_HOME

# App
USER node
WORKDIR $APP_HOME

COPY --chown=node package.json package-lock.json ./
RUN npm i
COPY --chown=node  ./ ./

ENTRYPOINT ["tini", "--"]
CMD [ "node", "docValidation.js" ]
