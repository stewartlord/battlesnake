const aStar = require('./a-star');

const SEARCH_TIMEOUT = 50;
const COST_HEAVY = 1000;
const COST_MODERATE = 250;
const COST_LIGHT = 100;

const STARVING = 15;
const HUNGRY = 50;

let state = {};

// Handle start requests
module.exports.start = function(req, res) {
  state = req.body;

  // Response data
  var data = {
    color: "#FF1493",
    name: "RUTHLESS",
    head_url: "https://raw.githubusercontent.com/stewartlord/battlesnake/master/head.png",
    taunt: "START",
  };

  return res.json(data);
}

// Handle move requests
module.exports.move = function(req, res) {
  console.log('-');
  state = req.body;

  let ourSnake = getSnake(state);
  let ourHead  = getHeadNode(ourSnake);
  let ourTail  = getTailNode(ourSnake);

  let result;
  let results = [];

  // compute paths to food
  let foodPaths = [];
  for (let i = 0; i < state.food.data.length; i++) {
    // enable reckless search when STARVING
    result = aStarSearch(state, ourHead, [state.food.data[i]], ourSnake.health <= STARVING);
    if (result.status != 'success') continue;
    result.goal = 'FOOD';
    foodPaths.push(result);
  }

  // eliminate unsafe food paths
  results = foodPaths.filter((result) => {
    // eliminate paths we can't reach in time
    if (result.path.length > ourSnake.health) return false;

    // eliminate food close to the head of a bigger enemy snake
    if (enemyDistance(state, result.path[result.path.length - 1]) < 3) return false;

    // eliminate paths we can't fit into (compute space size pessimistically)
    if (getSpaceSize(state, result.path[1], true) < ourSnake.body.data.length) return false;

    return true;
  });

  // determine closest food
  let closestFood = results.length && results.reduce((closest, current) => {
    return Math.min(current.path.length, closest);
  }, Number.MAX_SAFE_INTEGER);

  // we want to the be closest snake to at least one piece of food
  // determine how close we are vs. how close our enemies are
  let foodDistances = [];
  for (let i = 0; i < results.length; i++) {
    result = results[i];
    let foodNode = result.path[result.path.length - 1];
    let ourDistance = distance(ourHead, foodNode);
    let otherDistance = enemyDistance(state, foodNode);
    foodDistances.push({
      foodNode,
      ourDistance,
      enemyDistance: otherDistance,
      advantage: otherDistance - ourDistance
    })
  }
  let foodAdvantages = foodDistances.slice().sort((a, b) => b.advantage - a.advantage);
  let foodOpportunities = foodDistances.slice().sort((a, b) => b.enemyDistance - a.enemyDistance);
  let foodAdvantage = foodAdvantages.length && foodAdvantages[0];
  let foodOpportunity = foodOpportunities.length && foodOpportunities[0];

  // 'must eat' if STARVING or steps to food consume >=60% of health
  // 'should eat' if HUNGRY or steps to food consume >=30% of health
  // 'chase food' if food advantage is < 5
  let safeFood = results.length > 0;
  let mustEat = ourSnake.health <= STARVING || closestFood >= (ourSnake.health * .6);
  let shouldEat = safeFood && (ourSnake.health <= HUNGRY || closestFood >= (ourSnake.health * .3));
  let chaseFood = safeFood && foodAdvantage && foodAdvantage.advantage < 5;
  console.log('MUST/SHOULD/CHASE', mustEat, shouldEat, chaseFood);

  // if we must eat, but can't reach food, re-introduce unsafe paths
  let reachableFood = results.find(result => result.path.length < ourSnake.health);
  if (mustEat && !reachableFood) {
    results = foodPaths.slice();
  }

  // if eating is optional, seek tail nodes
  if (!mustEat || !results.length) {
    let tailTargets = goodNeighbors(state, ourTail);
    if (!isGrowing(ourSnake)) tailTargets.push(ourTail);
    for (let i = 0; i < tailTargets.length; i++) {
      result = aStarSearch(state, ourHead, [tailTargets[i]]);
      if (result.status != 'success') continue;
      if (result.path.length === 1) continue;
      result.goal = 'TAIL';
      results.push(result);
    }
  }

  // if eating is optional, consider head shots
  if (!mustEat) {
    try {
      let headShots = goodNeighbors(state, ourHead, true);
      for (let i = 0; i < headShots.length; i++) {
        // can only head shot smaller snakes
        let smallerSnake = isPossibleNextMove(state, getSmallerSnakes(state), headShots[i]);
        if (!smallerSnake) continue;

        // favor our guess at their next move
        let guessNext = guessNextMove(state, smallerSnake);
        results.push({
          goal: 'HEADSHOT',
          path: [ourHead, headShots[i]],
          cost: guessNext && isSameNode(headShots[i], guessNext) ? 0 : 1
        })
      }
    } catch (error) {
      // this code was added game day, don't trust it ^^
    }
  }

  // adjust the cost of paths
  for (let i = 0; i < results.length; i++) {
    let result = results[i];
    let path = result.path;
    let endNode = path[path.length - 1];
    let startNode = path[1];

    // heavily if we would starve en-route
    if (result.path.length > ourSnake.health) {
      result.cost += COST_HEAVY;
    }

    // heavily if end point has no path back to our tail
    if (!hasPathToTail(state, endNode, ourSnake)) {
      result.cost += COST_HEAVY;
    }

    // heavily/moderately/lightly if not a food path and we must-eat/should-eat/chase-food
    if (result.goal !== 'FOOD') {
      if (mustEat) {
        result.cost += COST_HEAVY;
      } else if (shouldEat) {
        result.cost += COST_MODERATE;
      } else if (chaseFood) {
        result.cost += COST_LIGHT;
      }
    }

    // lightly if a food path and we should not be eating
    if (result.goal === 'FOOD' && (!shouldEat && !mustEat && !chaseFood)) {
      result.cost += COST_LIGHT;
    }

    // lightly if: food path, multiple food paths, not our advantage and not most available
    if (result.goal === 'FOOD'
      && state.food.data.length > 1
      && foodAdvantage
      && (getNodeHash(endNode) !== getNodeHash(foodAdvantage.foodNode) || foodAdvantage.advantage < 1)
      && foodOpportunity
      && getNodeHash(endNode) !== getNodeHash(foodOpportunity.foodNode)
    ) {
      result.cost += COST_LIGHT;
    }
  }

  // if we found paths to goals, pick cheapest one
  if (results.length) {
    results.sort((a, b) => {
      return a.cost - b.cost;
    });
    results.forEach(result => console.log(result.goal, result.cost, result.path.length));
    return moveResponse(
      res,
      direction(ourHead, results[0].path[1]),
      'A* BEST PATH TO ' + results[0].goal
    );
  }

  // no best moves, pick the direction that has the most open space
  // first be pessimistic: avoid nodes next to enemy heads and spaces too small for us
  // if that fails, be optimistic: include nodes next to enemy heads and small spaces
  let moves = getSpaciousMoves(state, ourSnake, true);
  moves = moves.length ? moves : getSpaciousMoves(state, ourSnake);
  moves.sort((a, b) => {
    // avoid nodes bigger enemy snakes might move into
    if (a.spaceSize === b.spaceSize && a.isNextMove !== b.isNextMove) {
      return a.isNextMove - b.isNextMove;
    }

    // don't cut off escape routes
    if (a.spaceSize === b.spaceSize) {
      return a.wallCost - b.wallCost;
    }

    return b.spaceSize - a.spaceSize;
  });
  if (moves.length) {
    return moveResponse(
      res,
      direction(ourHead, moves[0].node),
      'NO PATH TO GOAL, LARGEST SPACE'
    );
  }

  // no valid moves
  return moveResponse(res, 'up', 'FML');
}

function getSpaciousMoves(state, ourSnake, pessimistic) {
  let moves = [];
  let ourHead = getHeadNode(ourSnake);
  let headNeighbors = pessimistic
    ? goodNeighbors(state, ourHead, true)
    : validNeighbors(state, ourHead);

  for (let i = 0; i < headNeighbors.length; i++) {
    let neighbor = headNeighbors[i];
    let spaceSize = getSpaceSize(state, neighbor, pessimistic);
    if (pessimistic && spaceSize < ourSnake.body.data.length) continue;
    moves.push({
      node: neighbor,
      direction: direction(ourHead, neighbor),
      spaceSize: spaceSize,
      wallCost: getWallCost(state, neighbor),
      isNextMove: isPossibleNextMove(state, getBiggerSnakes(state), neighbor)
    });
  }
  return moves;
}

function moveResponse(res, move, taunt) {
  taunt = taunt + ' ' + move;
  console.log(taunt);
  return res.json({move, taunt});
}

function enemyDistance(state, node) {
  let enemySnakes = getOtherSnakes(state);
  return enemySnakes.reduce((closest, current) => {
    let headNode = getHeadNode(current);
    return Math.min(distance(node, headNode), closest);
  }, Number.MAX_SAFE_INTEGER);
}

function getSpaceSize(state, node, pessimistic) {
  let validNodes = [node];
  let seenNodes  = {};
  seenNodes[getNodeHash(node)] = true;

  for (let i = 0; i < validNodes.length; i++) {
    // compute distance from current node to start node and subtract it from tails
    let tailTrim = distance(node, validNodes[i]);

    let neighbors = pessimistic
      ? goodNeighbors(state, validNodes[i], false, tailTrim)
      : validNeighbors(state, validNodes[i], tailTrim);
    for (let j = 0; j < neighbors.length; j++) {
      if (!seenNodes[getNodeHash(neighbors[j])]) {
        seenNodes[getNodeHash(neighbors[j])] = true;
        validNodes.push(neighbors[j]);
      }
    }
  }

  return validNodes.length;
}

function hasPathToTail(state, startNode, snake) {
  let snakeTail = getTailNode(snake);
  let result = aStarSearch(state, startNode, validNeighbors(state, snakeTail));
  return result.status == 'success';
}

function getHeadNode(snake) {
  return snake.body.data.slice(0,1)[0];
}

function getTailNode(snake) {
  return snake.body.data.slice(-1)[0];
}

function getSnake(state, snakeId) {
  if (!snakeId) snakeId = state.you.id;
  for (let snake of state.snakes.data) {
    if (snake.id == snakeId) return snake;
  }
}

function getOtherSnakes(state, snakeId) {
  if (!snakeId) snakeId = state.you.id;
  return state.snakes.data.filter((snake) => {
    return snake.id != snakeId;
  });
}

function getBiggerSnakes(state, snakeId) {
  if (!snakeId) snakeId = state.you.id;
  let subjectSnake = getSnake(state, snakeId);
  return state.snakes.data.filter((snake) => {
    return snake.id != snakeId && snake.body.data.length >= subjectSnake.body.data.length;
  });
}

function getSmallerSnakes(state, snakeId) {
  if (!snakeId) snakeId = state.you.id;
  let subjectSnake = getSnake(state, snakeId);
  return state.snakes.data.filter((snake) => {
    return snake.id != snakeId && snake.body.data.length < subjectSnake.body.data.length;
  });
}

function isSameNode(a, b) {
  return a.x === b.x && a.y === b.y;
}

function isInNodes(node, nodes, tailTrim) {
  tailTrim = tailTrim > 0 ? tailTrim : 0;
  for (let i = 0; i < (nodes.length - tailTrim); i++) {
    if (node.x === nodes[i].x && node.y === nodes[i].y) return true;
  }
  return false;
}

function isAdjacent(a, b) {
    if (a.x == b.x) {
      return a.y == b.y-1 || a.y == b.y+1
    } else if (a.y == b.y) {
      return a.x == b.x-1 || a.x == b.x+1
    }
    return false;
}

function isSnake(state, node, tailTrim) {
  // @todo don't tail trim snakes that are tail chasing
  for (let i = 0; i < state.snakes.data.length; i++) {
    if (isInNodes(node, state.snakes.data[i].body.data, tailTrim)) {
      return true;
    }
  }
  return false;
}

function isFood(state, node) {
  return isInNodes(node, state.food.data);
}

function isWall(state, node) {
  return node.x < 0 || node.x >= state.width || node.y < 0 || node.y >= state.height;
}

function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function neighbors(node) {
  return [
    {x: node.x - 1, y: node.y},
    {x: node.x + 1, y: node.y},
    {x: node.x, y: node.y - 1},
    {x: node.x, y: node.y + 1}
  ];
}

function validNeighbors(state, node, tailTrim) {
  return neighbors(node).filter((node) => {
    // walls are not valid
    if (isWall(state, node)) return false;

    // don't consider occupied nodes unless they are moving tails
    if (isSnake(state, node, tailTrim) && !isMovingTail(state, node)) return false;

    // looks valid
    return true;
  });
}

function goodNeighbors(state, node, headShot, tailTrim) {
  let otherSnakes = headShot ? getBiggerSnakes(state) : getOtherSnakes(state);
  return validNeighbors(state, node, tailTrim).filter((node) => {
    // don't consider nodes adjacent to the head of another snake
    return !isPossibleNextMove(state, otherSnakes, node);
  });
}

function isMovingTail(state, node) {
  for (let i = 0; i < state.snakes.data.length; i++) {
    let body = state.snakes.data[i].body.data;

    // if it's not the tail node, consider next snake
    if (!isSameNode(node, body[body.length - 1])) continue;

    // if snake is growing, tail won't move
    if (isGrowing(state.snakes.data[i])) return false;

    // must be a moving tail
    return true;
  }
  return false;
}

function isGrowing(snake) {
  let body = snake.body.data;
  return body.length > 1 && isSameNode(body[body.length - 1], body[body.length - 2]);
}

function isPossibleNextMove(state, snakes, node) {
  let filtered = snakes.filter((snake) => {
    return isInNodes(node, neighbors(getHeadNode(snake)));
  });
  return filtered.length ? filtered[0] : false;
}

function getProximityToSnakes(state, snakes, node) {
  let proximity = 0;
  let quarterBoard = (Math.min(state.width, state.height) - 1) / 4;
  for (let i = 0; i < snakes.length; i++) {
    if (snakes[i].id === state.you.id) continue;

    let headNode = getHeadNode(snakes[i]);
    let gap = distance(headNode, node);

    // insignificant proximity if > 1/4 of the board away
    if (gap >= quarterBoard) continue;

    proximity += (quarterBoard - gap) * 10
  }

  return proximity;
}

function heuristic(state, node) {
  // cost goes up if node is close to a wall because that limits escape routes
  let cost = getWallCost(state, node);

  // cost goes up if node is close to another snake
  cost += getProximityToSnakes(state, getOtherSnakes(state), node);

  return cost;
}

function direction(fromNode, toNode) {
  if (fromNode.y > toNode.y) return 'up';
  if (fromNode.y < toNode.y) return 'down';
  if (fromNode.x > toNode.x) return 'left';
  if (fromNode.x < toNode.x) return 'right';
}

function aStarSearch(state, startNode, targets, reckless) {
  let options = {
    start: startNode,
    isEnd: (node) => isInNodes(node, targets),
    neighbor: (node, path) => {
      return reckless
        ? validNeighbors(state, node, path.length)
        : goodNeighbors(state, node, node === startNode, path.length);
    },
    distance: distance,
    heuristic: (node) => reckless ? 0 : heuristic(state, node),
    hash: getNodeHash,
    timeout: SEARCH_TIMEOUT
  }
  return aStar(options);
}

function getNodeHash(node) {
  return `${node.x},${node.y}`
}

function getWallCost(state, node) {
  let halfWidth  = (state.width - 1) / 2;
  let halfHeight = (state.height - 1) / 2;
  let deviation  = [
    Math.abs(node.x - halfWidth)  / halfWidth,
    Math.abs(node.y - halfHeight) / halfHeight
  ];

  return Math.round(Math.max(...deviation) * ((halfWidth + halfHeight) / 4));
}

function getOccupiedNodes(snakes) {
  let nodes = [];
  for (let snake of snakes) {
    for (let i = 0; i < snake.body.data.length; i++) {
      nodes.push(snake.body.data[i]);
    }
  }
  return nodes;
}

function snakeDirection(snake) {
  if (snake.body.data.length < 2) return;
  let headNode = getHeadNode(snake);
  let nextNode = snake.body.data[1];
  return direction(nextNode, headNode);
}

function guessNextMove(state, snake) {
  let headNode = getHeadNode(snake);
  let possible = validNeighbors(state, headNode);

  let nextInLine;
  let currentDirection = snakeDirection(snake);
  if (currentDirection === 'up') {
    nextInLine = { x: headNode.x, y: headNode.y - 1 };
  } else if (currentDirection === 'down') {
    nextInLine = { x: headNode.x, y: headNode.y + 1 };
  } else if (currentDirection === 'left') {
    nextInLine = { x: headNode.x - 1, y: headNode.y };
  } else if (currentDirection === 'right') {
    nextInLine = { x: headNode.x + 1, y: headNode.y };
  }
  if (isInNodes(nextInLine, possible)) {
    return nextInLine;
  }

  return possible.length ? possible[0] : null;
}