# Ply
![GitHub Workflow Status](https://img.shields.io/github/workflow/status/ply-ct/ply/ply%20ci)

## REST API Automated Testing

## Contents
  - [Installation](#installation)
  - [Usage](#usage)
  - [Demo](#demo)
  - [Documentation](#documentation)
  - [VS Code Extension](#vs-code-extension)

## Installation
```sh
npm install ply-ct --save-dev
```
Or, to run anywhere:
```sh
npm install -g ply-ct
```

## Usage
Ply API testing starts with a YAML file containing requests. Here's a GET request to retrieve
topics for the [ply-demo](https://github.com/ply-ct/ply-demo) repository using
[GitHub API](https://developer.github.com/v3/repos/#get-all-repository-topics) v3:
```yaml
repositoryTopics:
  url: 'https://api.github.com/repos/ply-ct/ply-demo/topics'
  method: GET
  headers:
    Accept: application/vnd.github.mercy-preview+json
```

### Run a request
Suppose you save this in a file named "github.ply.yml". Then you can submit this
`repositoryTopics` request from the command line by typing:
```sh
ply -x github.ply.yml
```
The `-x` argument tells Ply not to verify the response (`-x` is short for `--exercise`, 
meaning submit an ad hoc request and don't bother with verification).

### Verify response
If you run without `-x` you'll get an error saying, "Expected result file not found". Ply verification
works by comparing expected vs actual. So a complete test requires an expected result file. Run again
with `--create` (create), and the expected result file will be created from the actual response.
```sh
ply --create github.ply.yml
```
Output looks like this:
```
Request 'repositoryTopics' submitted at 8/28/2020, 10:54:40:667
Creating expected result: ./results/expected/github.yml
Test 'repositoryTopics' PASSED in 303 ms
```
During execution Ply submits the request and writes **actual** result file "./results/actual/github.yml"
based on the response. This test naturally passed since **expected** result file "./results/expected/github.yml" 
was created directly from actual results, per `--create`.

### Expected results
Auto-creating an expected result provides a good starting point. But looking at "./results/expected/github.yml",
you'll notice that it includes many response headers that are not of interest for testing purposes. Here's a
cleaned-up version of similar expected results from [ply-demo](https://github.com/ply-ct/ply-demo/blob/master/test/requests/github-api.ply.yaml#L1):
```yaml
repositoryTopics:
  request:
    url: 'https://api.github.com/repos/${github.organization}/${github.repository}/topics'
    method: GET
    headers:
      Accept: application/vnd.github.mercy-preview+json
  response:
    status:
      code: 200
      message: OK
    headers:
      content-type: application/json; charset=utf-8
      status: 200 OK
    body: |-
      {
        "names": [
          "rest-api",
          "testing",
          "ply",
          "example-project",
          "graphql",
          "typescript",
          "github-workflow"
        ]
      }
```
The subset of response headers included in expected results YAML are those we care about for comparison.
In this test, body content is our main concern.

### Expressions
Something else about this example may be noticed by sharp-eyed observers: our request URL contains
placeholders like `${github.organization}`. JavaScript [template literal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals)
syntax is supported for substituting dynamic values, which can come from JSON files and/or environment variables.
Even more powerfully, in multi-request suites expressions can reference runtime values from previous responses.
This enables you to string together multiple requests that depend on response output from preceding requests.
These mechanisms are described in the [Results](https://ply-ct.github.io/ply/topics/results) and [Values](https://ply-ct.github.io/ply/topics/values) 
topics in Ply's documentation.

### Cases
TODO

### GraphQL
TODO

## Live Demo
TODO

## Documentation
TODO  
https://ply-ct.github.io/ply/topics/requests

## VS Code Extension
TODO  
https://github.com/ply-ct/vscode-ply



