import { VALID_COLUMNS, VALID_OPERATORS, VALID_LOGIC_OPERATORS } from './core.js';

export function validateExpression(expression) {
  if (!expression || !expression.trim()) {
    throw new Error('Выражение не может быть пустым');
  }

  const expr = expression.trim();
  if (!checkParenthesesBalance(expr)) {
    throw new Error('Несбалансированные скобки');
  }

  const tokens = tokenizeExpression(expr);
  if (tokens.length === 0) {
    throw new Error('Пустое выражение после токенизации');
  }
  validateSyntax(tokens);
  const ast = parseExpressionToAST(tokens);
  validateAST(ast);
  return true;
}

function checkParenthesesBalance(expr) {
  let balance = 0;
  for (let char of expr) {
    if (char === '(') balance++;
    if (char === ')') balance--;
    if (balance < 0) return false;
  }
  return balance === 0;
}

export function tokenizeExpression(expr) {
  const tokens = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];

    if ((char === '"' || char === "'") && !inString) {
      if (current.trim()) {
        tokens.push(current.trim());
      }
      inString = true;
      stringChar = char;
      current = char;
    } else if (char === stringChar && inString) {
      current += char;
      tokens.push(current);
      inString = false;
      current = '';
      stringChar = '';
    } else if (inString) {
      current += char;
    } else if ('()'.includes(char)) {
      if (current.trim()) {
        tokens.push(current.trim());
      }
      tokens.push(char);
      current = '';
    } else if (char === ' ' || char === '\t') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    tokens.push(current.trim());
  }
  
  return tokens.filter(token => token && token !== ' ');
}

function validateSyntax(tokens) {
  if (tokens.length === 0) {
    throw new Error('Пустое выражение');
  }

  const firstToken = tokens[0];
  const lastToken = tokens[tokens.length - 1];
  
  if (VALID_LOGIC_OPERATORS.includes(firstToken.toUpperCase()) && firstToken.toUpperCase() !== 'NOT') {
    throw new Error('Выражение не может начинаться с логического оператора ' + firstToken);
  }
  
  if (VALID_LOGIC_OPERATORS.includes(lastToken.toUpperCase())) {
    throw new Error('Выражение не может заканчиваться логическим оператором');
  }

  let expectColumnOrOpenParenOrNot = true;
  let parenBalance = 0;
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const upperToken = token.toUpperCase();
    
    if (token === '(') {
      parenBalance++;
      if (!expectColumnOrOpenParenOrNot && i > 0 && !VALID_LOGIC_OPERATORS.includes(tokens[i-1].toUpperCase())) {
        throw new Error(`Неожиданная открывающая скобка после ${tokens[i-1]}`);
      }
      expectColumnOrOpenParenOrNot = true;
    } else if (token === ')') {
      parenBalance--;
      if (parenBalance < 0) {
        throw new Error('Несбалансированные скобки');
      }
      expectColumnOrOpenParenOrNot = false;
    } else if (upperToken === 'NOT') {
      if (!expectColumnOrOpenParenOrNot) {
        throw new Error(`Неожиданный оператор NOT после ${tokens[i-1]}`);
      }
      expectColumnOrOpenParenOrNot = true;
    } else if (VALID_LOGIC_OPERATORS.includes(upperToken) && upperToken !== 'NOT') {
      if (expectColumnOrOpenParenOrNot) {
        throw new Error(`Неожиданный логический оператор ${token}`);
      }
      expectColumnOrOpenParenOrNot = true;
    } else if (VALID_OPERATORS.includes(token)) {
      if (expectColumnOrOpenParenOrNot) {
        throw new Error(`Неожиданный оператор сравнения ${token}`);
      }
      expectColumnOrOpenParenOrNot = false;
    } else if (isColumn(token)) {
      if (!expectColumnOrOpenParenOrNot) {
        throw new Error(`Неожиданный столбец ${token}`);
      }
      if (i + 1 >= tokens.length || !VALID_OPERATORS.includes(tokens[i + 1])) {
        throw new Error(`После столбца ${token} ожидается оператор сравнения`);
      }
      expectColumnOrOpenParenOrNot = false;
    } else if (isValue(token)) {
      if (expectColumnOrOpenParenOrNot) {
        throw new Error(`Неожиданное значение ${token}`);
      }
      expectColumnOrOpenParenOrNot = false;
    } else {
      throw new Error(`Неизвестный токен: ${token}`);
    }
  }
  
  if (parenBalance !== 0) {
    throw new Error('Несбалансированные скобки');
  }
}

export function parseExpressionToAST(tokens) {
  let index = 0;

  function parseExpression() {
    let left = parseTerm();
    
    while (index < tokens.length) {
      const token = tokens[index];
      const upperToken = token.toUpperCase();
      
      if (isLogicOperator(token) && upperToken !== 'NOT') {
        const operator = upperToken === '&&' ? 'AND' : upperToken === '||' ? 'OR' : upperToken;
        index++;
        const right = parseTerm();
        left = {
          type: 'logical',
          operator: operator,
          left: left,
          right: right
        };
      } else {
        break;
      }
    }
    
    return left;
  }

  function parseTerm() {
    if (index >= tokens.length) {
      throw new Error('Неожиданный конец выражения');
    }

    const token = tokens[index];
    const upperToken = token.toUpperCase();

    if (upperToken === 'NOT') {
      index++;
      
      if (index >= tokens.length) {
        throw new Error('Ожидается выражение после NOT');
      }
      
      let expr;
      if (tokens[index] === '(') {
        index++;
        expr = parseExpression();
        if (index >= tokens.length || tokens[index] !== ')') {
          throw new Error('Ожидается закрывающая скобка после NOT');
        }
        index++;
      } else {
        expr = parseCondition();
      }
      
      return {
        type: 'not',
        operator: 'NOT',
        expression: expr
      };
    }
    
    if (token === '(') {
      index++;
      const expr = parseExpression();
      if (index >= tokens.length || tokens[index] !== ')') {
        throw new Error('Ожидается закрывающая скобка');
      }
      index++;
      return expr;
    } else {
      return parseCondition();
    }
  }

  function parseCondition() {
    if (index + 2 >= tokens.length) {
      throw new Error('Неполное условие');
    }

    const column = tokens[index];
    const operator = tokens[index + 1];
    let value = tokens[index + 2];
    
    if (!isColumn(column)) {
      throw new Error(`Неизвестный столбец: ${column}`);
    }
    if (!VALID_OPERATORS.includes(operator)) {
      throw new Error(`Неизвестный оператор: ${operator}`);
    }

    let parsedValue;
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      parsedValue = value.slice(1, -1);
    } else if (isNumeric(value)) {
      parsedValue = parseFloat(value);
    } else {
      throw new Error(`Некорректное значение: ${value}`);
    }

    index += 3;
    
    return {
      type: 'condition',
      column: column,
      operator: operator,
      value: parsedValue
    };
  }

  try {
    const ast = parseExpression();
    if (index !== tokens.length) {
      throw new Error(`Необработанные токены: ${tokens.slice(index).join(' ')}`);
    }
    return ast;
  } catch (error) {
    throw new Error(`Ошибка парсинга: ${error.message}`);
  }
}

function validateAST(node) {
  if (node.type === 'condition') {
    if (!isColumn(node.column)) {
      throw new Error(`Неизвестный столбец: ${node.column}`);
    }
    if (!VALID_OPERATORS.includes(node.operator)) {
      throw new Error(`Неизвестный оператор: ${node.operator}`);
    }
    if (node.value === undefined || node.value === null) {
      throw new Error(`Отсутствует значение для условия`);
    }
  } else if (node.type === 'logical') {
    validateAST(node.left);
    validateAST(node.right);
  } else if (node.type === 'not') {
    validateAST(node.expression);
  }
}

export function convertASTToConditions(node) {
  if (node.type === 'condition') {
    return [{
      column: node.column,
      operator: node.operator,
      value: node.value,
      isGroup: false
    }];
  } else if (node.type === 'logical') {
    const leftConditions = convertASTToConditions(node.left);
    const rightConditions = convertASTToConditions(node.right);

    return [{
      logic: node.operator,
      conditions: [...leftConditions, ...rightConditions],
      isGroup: true
    }];
  } else if (node.type === 'not') {
    const expressionConditions = convertASTToConditions(node.expression);

    return [{
      logic: 'NOT',
      conditions: expressionConditions,
      isGroup: true
    }];
  }
  
  return [];
}

function isColumn(token) {
  return VALID_COLUMNS.includes(token);
}

function isLogicOperator(token) {
  return VALID_LOGIC_OPERATORS.includes(token.toUpperCase());
}

function isValue(token) {
  return isNumeric(token) || (token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'));
}

function isNumeric(str) {
  if (typeof str !== 'string') return false;
  return !isNaN(str) && !isNaN(parseFloat(str));
}