---
layout: topic
---
# Iterating

By including a .csv or .xlsx file in Ply [valuesFiles](values#rowwise-values), you're able
to repeatedly execute tests for each row in a dataset. You can take advantage of this feature
to perform load testing on your APIs, or simply to run with varying input permutations.

## Syntax
The first row in a .csv/.xlsx values file designates value names and object structure.
Take this example which includes the first few rows from ply-demo's [movies.csv file](https://github.com/ply-ct/ply-demo/blob/master/test/values/movies.csv):
```csv
title,         year, rating, poster,  credits[0].name, credits[0].role, credits[1].name, credits[1].role, credits[2].name, credits[2].role, credits[3].name, credits[3].role, credits[4].name,  credits[4].role, credits[5].name,  credits[5].role, webRef.site, webRef.ref, description
The Ape,       1940, 3,      ta.jpg,  William Nigh,    director,        Boris Karloff,   actor,           Maris Wrixon,    actor,           Gene O'Donnel,   actor,           Dorothy Vaughan,  actor,           Gertrude Hoffman, actor,           imdb.com,    tt0032215,  Karloff's nuanced performance as the well-meaning but demented scientist is the one redeeming feature in this cheaply made horror melodrama which provides very little in the way of horror or drama.
Before I Hang, 1940, 3.5,    bih.jpg, Nick Grinde,     director,        Boris Karloff,   actor,           Evelyn Keyes,    actor,           Bruce Bennet,    actor,           Edward Van Sloan, actor,           Ben Taggart,      actor,           imdb.com,    tt0032245,  Karloff gives great face as the kindly doctor who inadvertantly turns himself into a maniacal killer in this rather stuffy melodramatic thriller from Columbia Pictures.
Black Friday,  1940, 3,      bf.jpg,  Arthur Lubin,    director,        Boris Karloff,   actor,           Bela Lugosi,     actor,           Stanley Ridges,  actor,           Ann Nagel,        actor,           Anne Gwynne,      actor,           imdb.com,    tt0032258,  Karloff and Lugosi team up in what amounts to more of a crime drama with supernatural elements than a straight horror film.
```
This translates into the following values object structure:
```json
{
  "title": "The Ape",
  "year": 1940,
  "rating": 3,
  "poster": "ta.jpg",
  "credits": [
    {
      "name": "William Nigh",
      "role": "director"
    },
    {
      "name": "Boris Karloff",
      "role": "actor"
    },
    {
      "name": "Maris Wrixon",
      "role": "actor"
    },
    {
      "name": "Gene O'Donnel",
      "role": "actor"
    },
    {
      "name": "Dorothy Vaughan",
      "role": "actor"
    },
    {
      "name": "Gertrude Hoffman",
      "role": "actor"
    }
  ],
  "webRef": {
    "site": "imdb.com",
    "ref": "tt0032215"
  },
  "description": "Karloff's nuanced performance as the well-meaning but demented scientist is the one redeeming feature in this cheaply made horror melodrama which provides very little in the way of horror or drama."
}
```
So then in [row-requests.ply.yaml](https://github.com/ply-ct/ply-demo/blob/master/test/requests/row-requests.ply.yaml) request suite, we can reference these values in our `createMovie` request:
```yaml
createMovie: # POST
  url: ${baseUrl}/movies
  method: POST
  headers:
    Accept: application/json
    Content-Type: application/json
  body: |-
    {
      "credits": [
        {
          "name": "${credits[0].name}",
          "role": "${credits[0].role}"
        },
        {
          "name": "${credits[1].name}",
          "role": "${credits[1].role}"
        },
        {
          "name": "${credits[2].name}",
          "role": "${credits[2].role}"
        },
        {
          "name": "${credits[3].name}",
          "role": "${credits[3].role}"
        },
        {
          "name": "${credits[4].name}",
          "role": "${credits[4].role}"
        },
        {
          "name": "${credits[5].name}",
          "role": "${credits[5].role}"
        }
      ],
      "poster": "${poster}",
      "rating": ${rating},
      "title": "${title}",
      "webRef": {
        "ref": "${webRef.ref}",
        "site": "${webRef.site}"
      },
      "year": ${year}
    }
```
Each run (one per row) executes with the corresponding values from the dataset.

## Load testing
For large datasets such as might be used in load-testing, .csv values are recommended over .xlsx.
The reason for this is that .xlsx files are always loaded into memory; whereas .csv files are [streamed
and buffered](https://nodejs.org/api/stream.html#stream_types_of_streams).

Two [config options](config) can help control how fast requests are submitted against an API:
  - `batchRows` - Number of rows included with each batch of requests (default = 1)
  - `batchDelay` - Milliseconds to pause between batch executions (default = 0)

Another option to consider is `submit`, which tells Ply to skip verification of results. This can be
useful in load testing so that Ply doesn't spend time comparing results and can crank up greater
throughput. On the command line, use `--submit`. In VS Code, click the 'Submit' code lens or the Submit icon:
<img src="../img/submit.svg" alt="Submit Icon" class="icon-img">

## Parallel execution
Suites by default are executed sequentially, with Ply waiting for one suite to complete before running 
the next. As with non-iterating tests, the `parallel` config option can be used to execute suites in parallel.
With rowwise values, `parallel` applies to how rows are handled as well (multiple rows are submitted simultaneously).
When iterating in parallel there are couple of things to keep in mind:
  - Test suites that interfere with each other's data will cause inconsistencies when run in parallel.
  - The `submit` option described above should be used to suppress results verification. Ply writes actual
    suite results to the same file for each row processed. This will cause interference during parallel execution.

Next Topic: [Cases](cases)