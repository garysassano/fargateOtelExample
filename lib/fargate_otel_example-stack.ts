import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { SecurityGroup, IVpc, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  FargateService,
  TaskDefinition,
  Compatibility,
  ContainerDefinitionOptions,
  LogDriver,
  NetworkMode,
  Protocol,
  ContainerDependencyCondition,
} from "aws-cdk-lib/aws-ecs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";

export class FargateOtelExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get the default VPC
    const network = Vpc.fromLookup(this, "DefaultVPC", {
      isDefault: true,
    });

    // Create a new ECS cluster
    const cluster = new Cluster(this, "ApiCluster", {
      vpc: network,
      clusterName: "otel-example-cluster",
    });

    // Create security group
    const securityGroup = new SecurityGroup(this, `ApiSvcSecurityGroup`, {
      allowAllOutbound: true,
      vpc: network,
      securityGroupName: "ExampleApiSecurityGroup",
    });

    // Create task execution role
    const executionRole = new Role(this, "TaskExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    executionRole.addManagedPolicy({
      managedPolicyArn:
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });
    // Add permissions for pulling from ECR Public
    executionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ecr-public:GetAuthorizationToken",
          "ecr-public:BatchCheckLayerAvailability",
          "ecr-public:GetRepositoryPolicy",
          "ecr-public:DescribeRepositories",
          "ecr-public:DescribeImages",
          "ecr-public:BatchGetImage",
          "ecr-public:GetImage",
          "sts:GetServiceBearerToken",
        ],
        resources: ["*"],
      })
    );

    // Create task role
    const taskRole = new Role(this, "RoleSvc", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    taskRole.addManagedPolicy({
      managedPolicyArn:
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    // Create task definition
    const taskDefinition = new TaskDefinition(this, `ApiSvcDefinition`, {
      compatibility: Compatibility.FARGATE,
      cpu: "512",
      networkMode: NetworkMode.AWS_VPC,
      memoryMiB: "1024",
      taskRole,
      executionRole,
    });

    // Add container to task definition
    const mainContainer = taskDefinition.addContainer("apiSvcTaskDefinition", {
      image: ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      essential: true,
      portMappings: [
        {
          containerPort: 80,
          hostPort: 80,
          protocol: Protocol.TCP,
        },
      ],
      logging: LogDriver.awsLogs({
        logRetention: RetentionDays.ONE_WEEK,
        streamPrefix: "/ecs/api-svc",
      }),
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      environment: {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4317",
      },
    });

    // Add OpenTelemetry configuration
    taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "logs:PutLogEvents",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:DescribeLogGroups",
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
          "xray:GetSamplingStatisticSummaries",
          "ssm:GetParameters",
        ],
        resources: ["*"],
      })
    );

    // Add OpenTelemetry container
    const otelContainer = taskDefinition.addContainer("otelContainer", {
      image: ContainerImage.fromRegistry(
        "public.ecr.aws/aws-observability/aws-otel-collector:v0.33.1"
      ),
      command: [
        "--config=/etc/ecs/container-insights/otel-task-metrics-config.yaml",
      ],
      essential: true,
      portMappings: [
        {
          containerPort: 4317,
          hostPort: 4317,
          protocol: Protocol.TCP,
        },
        {
          containerPort: 4318,
          hostPort: 4318,
          protocol: Protocol.TCP,
        },
        {
          containerPort: 2000,
          hostPort: 2000,
          protocol: Protocol.UDP,
        },
        {
          containerPort: 13133,
          hostPort: 13133,
          protocol: Protocol.TCP,
        },
      ],
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:13133/ || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      logging: LogDriver.awsLogs({
        logRetention: RetentionDays.ONE_WEEK,
        streamPrefix: "/ecs/otel-sidecar-collector",
      }),
    });

    // Add container dependency
    otelContainer.addContainerDependencies({
      container: mainContainer,
      condition: ContainerDependencyCondition.HEALTHY,
    });

    // Create Fargate service
    new FargateService(this, "ApiService", {
      assignPublicIp: true,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      cluster,
      serviceName: "ExampleService",
      securityGroups: [securityGroup],
      taskDefinition,
      enableECSManagedTags: true,
      capacityProviderStrategies: [
        {
          capacityProvider: "FARGATE_SPOT",
          weight: 2,
        },
        {
          capacityProvider: "FARGATE",
          weight: 1,
          base: 1,
        },
      ],
    });
  }
}
