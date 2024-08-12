//const apiDocData = require("./apiDocumentationData.json");
const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");
const { MongoClient, ObjectId } = require("mongodb");

const uri = "mongodb://db_user:52hbBtlH5uFKOd4p@zluri-dev-v5-shard-00-00.hpjxh.mongodb.net:27017,zluri-dev-v5-sha...tabase:27017/admin?authSource=admin&replicaSet=atlas-10fmtc-shard-0&w=majority&readPreference=primary&retryWrites=true&ssl=true";
const client = new MongoClient(uri);

async function main() {
  let db;

  const dbInit = async () => {
    await client
      .connect()
      .then(() => {
        console.log("Database connected");
        db = client.db("zluri");
      })
      .catch((error) => {
        console.error(error);
      });
  };

  await dbInit();

  const collection = await db.collection("integration_documents_url");

  const apiDocData = await collection.find().toArray();
  client.close();
  console.log(process.env)
  const { chromium } = require("playwright-chromium");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true
  });

  const s3 = new AWS.S3();
  const bucketName = "zluri-prod-integrations-documents";

  const page = await browser.newPage({ headless: false });

  async function getDocumentationText(url, start_node, use_end_node = false) {
    async function areSameElements(elementHandle1, elementHandle2) {
      const result = await page.evaluate(({ el1, el2 }) => el1 === el2, {
        el1: elementHandle1,
        el2: elementHandle2,
      });

      return result;
    }

    await page.goto(url, {
      waitUntil: "domcontentloaded",
    });

    // const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    // await delay(20000)

    start_node = await page.$(start_node);
    var text = "";

    if (use_end_node) {
      end_node = await page.$("#update-current-user-s-profile");

      async function getTextContentBetweenElements(start, end) {
        end = await page.evaluate((el) => el, end);
        var textContent = "";
        var node = start; //await page.evaluateHandle((el) => el.firstChild, start);

        var n = 0;
        while (true) {
          n++;
          textContent += (await node.textContent()) + "\n";
          node = await page.evaluateHandle((el) => el.nextElementSibling, node);
          if (await areSameElements(node, end_node)) {
            break;
          }
        }

        //page.close()

        return textContent;
      }

      text = await getTextContentBetweenElements(start_node, end_node);
    } else {
      var node = start_node;
      const baseElementStyle = await page.evaluate(
        (el) => getComputedStyle(el),
        node
      );
      const baseElementFontSize = baseElementStyle.fontSize;
      text += (await node.textContent()) + "\n";
      node = await page.evaluateHandle((el) => el.nextElementSibling, node);

      var n = 1;

      while (true) {
        n++;
        var ElementStyle = await page.evaluate((el) => {
          if (el == null) {
            return null;
          }
          return getComputedStyle(el);
        }, node);
        if (ElementStyle == null) {
          break;
        }
        var ElementFontSize = ElementStyle.fontSize;
        if (ElementFontSize >= baseElementFontSize) break;

        text += (await node.textContent()) + "\n";
        node = await page.evaluateHandle((el) => el.nextElementSibling, node);
      }
    }
    return text;
  }

  let changes = [];

  for (const element of apiDocData) {
    const folderName = `${element.integrationName}/`;

    changeArr = [];
    for (const api of element.apis) {
      const fileName = `${api.apiDocumentData.apiHeading}.txt`;
      const text = await getDocumentationText(
        api.apiDocumentData.apiDocumentUrl,
        api.apiDocumentData.apiSelector
      );

      const params = {
        Bucket: bucketName,
        Key: `${folderName}${fileName}`,
      };

      let objectFound = false;

      s3.headObject(params, (err, data) => {
        if (err) {
          if (err.code == "NotFound") {
            console.log(`${folderName}${fileName} does not exist`);
          } else {
            throw err;
          }
        } else {
          console.log(`${folderName}${fileName} exists.`);
          objectFound = true;
        }
      });

      if (!objectFound) {
        const params = {
          Bucket: bucketName,
          Key: `${folderName}${fileName}`,
          Body: text,
        };

        s3.upload(params, (err, data) => {
          if (err) {
            throw err;
          }
        });
      } else {
        const params = {
          Bucket: bucketName,
          Key: `${folderName}${fileName}`,
        };

        const prev_text = s3.getObject(params, (err, data) => {
          if (err) {
            throw err;
          }

          return data.Body.toString();
        });

        const Diff = require("diff");
        const diff = Diff.diffWords(prev_text, text, {
          ignoreWhitespace: true,
        });

        var additions = [];
        var deletions = [];
        diff.forEach((element) => {
          if (element.value) {
            if (element.added) {
              additions.push(element.value);
            } else if (element.removed) {
              deletions.push(element.value);
            }
          }
        });

        if (additions.length != 0 || deletions.length != 0) {
          const apiChanges = {
            name: api.apiDocumentData.apiHeading,
            Additions: additions,
            Deletions: deletions,
          };
          changeArr.push(apiChanges);
        }
      }
    }
    changes.push(changeArr);
  }

  let blockText = [];

  for (let i = 0; i < changes.length; i++) {
    if (changes[i].length == 0) break;

    blockText.push(`${i + 1}) ${apiDocData[i].integrationName}\n`);

    for (let j = 0; j < changes[i].length; j++) {
      blockText.push(`${i + 1}.${j + 1}) ${changes[i][j].name}\n`);

      if (changes[i][j].Additions.length != 0) {
        blockText.push(
          "```Additions: " +
            `${JSON.stringify(changes[i][j].Additions)}` +
            "```\n"
        );
      }

      if (changes[i][j].Deletions.length != 0) {
        blockText.push(
          "```Deletions: " +
            `${JSON.stringify(changes[i][j].Deletions)}` +
            "```\n"
        );
      }
    }
  }

  let blocks = [];

  blockText.forEach((element) => {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${element}`,
      },
    });
  });

  var request = require("request");
  var options = {
    method: "POST",
    url: "https://hooks.slack.com/services/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",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ blocks: blocks }),
  };

  request(options, function (error, response) {
    if (error) throw new Error(error);
    console.log(response.body);
  });

  browser.close();
}

main();
