#!/bin/bash

# docker build -t cascade . && docker run -it cascade /tmp/tmp-test.sh

mkdir /tmp/p
cd /tmp/p 
env GH_TOKEN=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 gh repo clone https://github.com/zbigniewsobiecki/niu.git
cd niu
pnpm install
